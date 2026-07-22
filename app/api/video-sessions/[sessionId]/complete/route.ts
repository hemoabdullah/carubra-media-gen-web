import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { findOne, updateOne, deleteOne, insert } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'
import { readTempVideo, deleteTempVideo, deleteSessionTempVideos } from '@/lib/temp-storage'
import { uploadToStorage } from '@/lib/supabase'

/**
 * POST /api/video-sessions/[sessionId]/complete
 * Complete session: upload final video to Supabase and save to videos table
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sessionId } = await params
    const session = await findOne('video_sessions', { id: sessionId, user_id: user.id })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (session.status !== 'editing') {
      if (session.status === 'completed') {
        const existingVideo = await findOne('videos', { user_id: user.id, prompt: session.current_prompt })
        if (existingVideo) {
          return NextResponse.json({ video: existingVideo, session: { id: sessionId, status: 'completed' } })
        }
      }
      return NextResponse.json({ error: 'Session is not in editing state' }, { status: 400 })
    }

    if (!session.draft_video_path) {
      return NextResponse.json({ error: 'No draft video to save' }, { status: 400 })
    }

    // Read temp video file
    let videoBuffer: Buffer
    try {
      const filename = session.draft_video_path.split('/').pop()
      if (!filename) {
        throw new Error('Invalid draft video path')
      }
      videoBuffer = await readTempVideo(filename)
    } catch (error) {
      console.error('[video-sessions/complete] Failed to read temp video:', error)
      return NextResponse.json({ error: 'Failed to read draft video' }, { status: 500 })
    }

    // Upload to Supabase Storage (transactional)
    let finalVideoUrl: string
    try {
      const storagePath = `${user.id}/${uuidv4()}.mp4`
      finalVideoUrl = await uploadToStorage('generated-videos', storagePath, videoBuffer, {
        contentType: 'video/mp4',
        cacheControl: 'public, max-age=31536000',
      })
    } catch (uploadError) {
      console.error('[video-sessions/complete] Upload failed:', uploadError)
      return NextResponse.json({ error: 'Failed to upload video to storage' }, { status: 500 })
    }

    // Create final video record in database
    const videoId = uuidv4()
    const videoRecord = {
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
    }

    try {
      await insert('videos', videoRecord)
    } catch (dbError) {
      console.error('[video-sessions/complete] Database insert failed:', dbError)
      // Rollback: delete uploaded file
      try {
        const storagePath = finalVideoUrl.split('/').pop()
        if (storagePath) {
          const supabase = await (await import('@/lib/supabase')).getSupabaseAdmin()
          await supabase.storage.from('generated-videos').remove([storagePath])
        }
      } catch (rollbackError) {
        console.error('[video-sessions/complete] Rollback failed:', rollbackError)
      }
      return NextResponse.json({ error: 'Failed to save video record' }, { status: 500 })
    }

    // Update session status to completed
    await updateOne('video_sessions', { id: sessionId }, {
      status: 'completed',
      updated_at: new Date(),
    })

    // Update current version with final URL
    const currentVersion = await findOne('video_session_versions', {
      session_id: sessionId,
      version_number: session.current_version,
    })
    if (currentVersion) {
      await updateOne('video_session_versions', { id: currentVersion.id }, {
        video_url: finalVideoUrl,
        status: 'completed',
      })
    }

    // Clean up temp files
    await deleteSessionTempVideos(sessionId)

    return NextResponse.json({
      video: { id: videoId, video_url: finalVideoUrl },
      session: { id: sessionId, status: 'completed' },
    })
  } catch (error: any) {
    console.error('[video-sessions/complete] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
