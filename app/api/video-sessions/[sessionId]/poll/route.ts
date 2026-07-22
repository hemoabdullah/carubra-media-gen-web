import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { findOne, updateOne, insert, uploadToStorage } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'
import { saveTempVideo, generateTempFilename, readTempVideo } from '@/lib/temp-storage'
import { getConfig } from '@/lib/vertex'
import { getVertexAccessToken, pollVertexOperation, downloadFromGCS, listGCSVideos, normalizeOperationName } from '@/lib/video-generation'

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sessionId } = await params
    console.log(`[poll] ===== POLL REQUEST ===== session: ${sessionId}, user: ${user.id}`)

    const session = await findOne('video_sessions', { id: sessionId, user_id: user.id })
    if (!session) {
      console.error(`[poll] FAILURE: Session not found: ${sessionId}`)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    console.log(`[poll] SUCCESS: Session found, status: ${session.status}, current_version: ${session.current_version}`)

    const currentVersion = await findOne('video_session_versions', {
      session_id: sessionId,
      version_number: session.current_version,
    })

    if (!currentVersion) {
      console.error(`[poll] FAILURE: Version not found for session ${sessionId}, version ${session.current_version}`)
      return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    }

    console.log(`[poll] Version: ${currentVersion.version_number}, job_id: ${currentVersion.job_id}, draft_video_path: ${currentVersion.draft_video_path}`)

    if (currentVersion.draft_video_path) {
      console.log(`[poll] SUCCESS: Video already available at: ${currentVersion.draft_video_path}`)
      return NextResponse.json({
        status: 'completed',
        draft_video_path: currentVersion.draft_video_path,
        session: {
          ...session,
          draft_video_path: currentVersion.draft_video_path,
        },
      })
    }

    if (!currentVersion.job_id) {
      console.error('[poll] FAILURE: No job ID found for this version')
      return NextResponse.json({
        status: 'failed',
        error: 'No job ID found for this version',
      })
    }

    const config = getConfig()
    const jobIdRaw = currentVersion.job_id
    const normalizedJobId = normalizeOperationName(jobIdRaw, config)

    console.log('[poll] Pre-request diagnostic:')
    console.log('  project:', config.project)
    console.log('  location:', config.location)
    console.log('  model:', config.model)
    console.log('  hasCredentials:', !!config.credentialsPath)
    console.log('  job_id from DB:', jobIdRaw)
    console.log('  normalized job_id:', normalizedJobId)

    const accessToken = await getVertexAccessToken(config)
    console.log('[poll] Access token obtained (length:', accessToken.length, ')')

    console.log('[poll] ===== POLLING VERTEX AI =====')
    let pollData: any
    let pollingStrategy: string

    try {
      const result = await pollVertexOperation(normalizedJobId, config, accessToken)
      pollData = result.data
      pollingStrategy = result.strategy
      console.log(`[poll] SUCCESS: Poll returned data using strategy: ${pollingStrategy}`)
    } catch (pollErr: any) {
      console.error(`[poll] FAILURE: Polling failed: ${pollErr.message}`)

      console.log('[poll] ===== GCS RECOVERY ATTEMPT =====')
      try {
        const gcsFiles = await listGCSVideos(sessionId, config)
        if (gcsFiles.length > 0) {
          const latestFile = gcsFiles[gcsFiles.length - 1]
          console.log('[poll] GCS RECOVERY: Found potential video file:', latestFile)
          try {
            const buffer = await downloadFromGCS(latestFile, config)
            console.log('[poll] GCS RECOVERY SUCCESS: Downloaded', buffer.length, 'bytes')

            const filename = generateTempFilename(sessionId, session.current_version)
            const tempPath = await saveTempVideo(filename, buffer)
            console.log('[poll] GCS RECOVERY: Video saved to temp:', tempPath)

            await updateOne('video_session_versions', { id: currentVersion.id }, {
              draft_video_path: tempPath,
              status: 'draft',
            })
            console.log('[poll] GCS RECOVERY: Version updated with draft_video_path')

            const updatedSession = await updateOne('video_sessions', { id: sessionId }, {
              draft_video_path: tempPath,
              updated_at: new Date(),
            })
            console.log('[poll] GCS RECOVERY: Session updated with draft_video_path')

            return NextResponse.json({
              status: 'completed',
              draft_video_path: tempPath,
              session: updatedSession,
            })
          } catch (gcsErr: any) {
            console.error('[poll] GCS RECOVERY FAILED:', gcsErr.message)
          }
        } else {
          console.log('[poll] GCS RECOVERY: No files found in GCS bucket')
        }
      } catch (listErr: any) {
        console.error('[poll] GCS RECOVERY ERROR:', listErr.message)
      }

      return NextResponse.json({
        status: 'failed',
        error: `Failed to poll Vertex AI: ${pollErr.message}`,
      })
    }

    const operationStatus = pollData.done
      ? (pollData.error ? 'failed' : 'completed')
      : 'processing'

    console.log(`[poll] Operation status: ${operationStatus} (done: ${pollData.done}, hasError: ${!!pollData.error})`)

    if (operationStatus === 'completed') {
      console.log('[poll] ===== VIDEO GENERATION COMPLETED =====')

      const refreshedVersion = await findOne('video_session_versions', {
        session_id: sessionId,
        version_number: session.current_version,
      })
      if (refreshedVersion?.draft_video_path) {
        console.log('[poll] Another request already saved the video at:', refreshedVersion.draft_video_path)
        const updatedSession = await findOne('video_sessions', { id: sessionId })
        return NextResponse.json({
          status: 'completed',
          draft_video_path: refreshedVersion.draft_video_path,
          session: updatedSession || session,
        })
      }

      let fileBuffer: Buffer | null = null
      let detectedMime = 'video/mp4'

      const resp = pollData?.response || pollData?.operation?.response || pollData
      const firstVideo = resp?.videos?.[0]
      const encodedVideo: string | null = firstVideo?.bytesBase64Encoded || null
      const inlineMimeType: string | null = firstVideo?.mimeType || null
      const gcsUri: string | null = firstVideo?.gcsUri || null

      console.log('[poll] Video extraction:')
      console.log('  response exists:', !!resp)
      console.log('  response keys:', resp ? Object.keys(resp) : 'N/A')
      console.log('  videos[0] exists:', !!firstVideo)
      console.log('  bytesBase64Encoded:', !!encodedVideo)
      console.log('  mimeType:', inlineMimeType)
      console.log('  gcsUri:', gcsUri)

      if (encodedVideo) {
        try {
          detectedMime = inlineMimeType || 'video/mp4'
          console.log(`[poll] Decoding inline base64 video (${encodedVideo.length} chars)...`)
          fileBuffer = Buffer.from(encodedVideo, 'base64')
          console.log(`[poll] Decoded buffer: ${fileBuffer.length} bytes`)
          if (fileBuffer.length === 0) {
            throw new Error('Decoded base64 video is 0 bytes')
          }
          console.log('[poll] SUCCESS: Inline video decoded')
        } catch (decodeErr: any) {
          console.error('[poll] FAILURE: Inline decode error:', decodeErr.message)
          fileBuffer = null
        }
      }

      if (!fileBuffer && gcsUri && typeof gcsUri === 'string' && gcsUri.startsWith('gs://')) {
        try {
          fileBuffer = await downloadFromGCS(gcsUri, config)
          console.log('[poll] SUCCESS: Video downloaded from GCS')
        } catch (gcsErr: any) {
          console.error('[poll] FAILURE: GCS download failed:', gcsErr.message)
          fileBuffer = null
        }
      }

      if (!fileBuffer) {
        console.error('[poll] FAILURE: No video data found in completed response')
        return NextResponse.json({
          status: 'failed',
          error: 'No video data found in completed response',
        })
      }

      const filename = generateTempFilename(sessionId, session.current_version)
      const tempPath = await saveTempVideo(filename, fileBuffer)
      console.log(`[poll] SUCCESS: Temp video saved: ${tempPath}`)

      const versionUpdated = await updateOne(
        'video_session_versions',
        { id: currentVersion.id, draft_video_path: null },
        {
          draft_video_path: tempPath,
          status: 'draft',
        }
      )
      if (!versionUpdated) {
        const existing = await findOne('video_session_versions', { id: currentVersion.id })
        console.log('[poll] Another request already set draft_video_path:', existing?.draft_video_path)
        const updatedSession = await findOne('video_sessions', { id: sessionId })
        return NextResponse.json({
          status: 'completed',
          draft_video_path: existing?.draft_video_path || tempPath,
          session: updatedSession || session,
        })
      }
      console.log('[poll] SUCCESS: Version updated with draft_video_path')

      const updatedSession = await updateOne('video_sessions', { id: sessionId }, {
        draft_video_path: tempPath,
        updated_at: new Date(),
      })
      console.log('[poll] SUCCESS: Session updated with draft_video_path')

      console.log('[poll] ===== AUTO-SAVING TO HISTORY =====')
      try {
        const videoId = uuidv4()
        const storagePath = `${user.id}/${videoId}.mp4`
        const finalVideoUrl = await uploadToStorage('generated-videos', storagePath, fileBuffer, {
          contentType: 'video/mp4',
          cacheControl: 'public, max-age=31536000',
        })
        console.log('[poll] Auto-uploaded to Supabase Storage:', finalVideoUrl)

        await insert('videos', {
          id: videoId,
          user_id: user.id,
          prompt: session.current_prompt,
          model: session.model,
          resolution: session.resolution,
          aspect_ratio: session.aspect_ratio,
          duration: session.duration,
          coins_used: session.coins_used,
          status: 'completed',
          video_url: finalVideoUrl,
          source_image_url: session.source_image_url,
          created_at: new Date(),
          updated_at: new Date(),
        })
        console.log('[poll] SUCCESS: Video record created in history')

        await updateOne('video_session_versions', { id: currentVersion.id }, {
          video_url: finalVideoUrl,
          status: 'completed',
        })

        await updateOne('video_sessions', { id: sessionId }, {
          status: 'completed',
          updated_at: new Date(),
        })
        console.log('[poll] SUCCESS: Session marked as completed')
      } catch (autoSaveErr: any) {
        console.error('[poll] Auto-save to history failed (non-fatal):', autoSaveErr.message)
      }

      console.log('[poll] ===== PREVIEW URL RETURNED =====')

      return NextResponse.json({
        status: 'completed',
        draft_video_path: tempPath,
        session: updatedSession,
      })
    }

    if (operationStatus === 'failed') {
      const errorDetail = pollData.error
        ? `${pollData.error.message || ''} (code: ${pollData.error.code || 'unknown'})`
        : 'Unknown error'
      console.error('[poll] FAILURE: Operation failed:', errorDetail)
      return NextResponse.json({
        status: 'failed',
        error: errorDetail,
      })
    }

    console.log('[poll] Still processing... returning polling status')
    return NextResponse.json({
      status: 'polling',
      message: 'Still generating...',
    })
  } catch (error: any) {
    console.error('[poll] FATAL ERROR:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
