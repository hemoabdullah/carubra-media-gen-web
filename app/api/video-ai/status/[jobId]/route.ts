import { NextRequest, NextResponse } from 'next/server'
import { findOne, updateOne, uploadToStorage } from '@/lib/supabase'
import { creditUserCoins } from '@/lib/coins'
import { getUserFromRequest } from '@/middleware/auth'
import { getOperationEndpoint, getConfig } from '@/lib/vertex'
import { v4 as uuidv4 } from 'uuid'

/**
 * Detect the MIME type from a file buffer's magic bytes.
 * Only checks for video formats relevant to Vertex AI Veo output.
 */
function detectMimeFromBuffer(buffer: Buffer): string {
  const len = buffer.length
  if (len < 12) return 'video/mp4' // fallback
  const header = buffer.subarray(0, 12).toString('hex').toLowerCase()
  // WebM / Matroska: 1a45dfa3
  if (header.startsWith('1a45dfa3')) return 'video/webm'
  // MP4: ftype box at offset 4 (bytes 4-7)
  if (header.substring(8, 16) === '66747970') return 'video/mp4'
  // QuickTime: 'ftyp' or 'moov' start
  if (header.includes('6d6f6f76')) return 'video/quicktime'
  return 'video/mp4' // fallback
}

/**
 * Detect video dimensions (width, height) from MP4 buffer by parsing the tkhd box.
 * Returns null if dimensions cannot be determined.
 */
function detectVideoDimensions(buffer: Buffer): { width: number; height: number } | null {
  const len = buffer.length
  let offset = 0

  while (offset + 8 < len) {
    const boxSize = buffer.readUInt32BE(offset)
    if (boxSize < 8 || boxSize > len - offset) break
    const boxType = buffer.toString('ascii', offset + 4, offset + 8)

    if (boxType === 'moov') {
      let moovOffset = offset + 8
      const moovEnd = offset + boxSize

      while (moovOffset + 8 < moovEnd) {
        const subSize = buffer.readUInt32BE(moovOffset)
        if (subSize < 8) break
        const subType = buffer.toString('ascii', moovOffset + 4, moovOffset + 8)

        if (subType === 'trak') {
          let trakOffset = moovOffset + 8
          const trakEnd = moovOffset + subSize

          while (trakOffset + 8 < trakEnd) {
            const childSize = buffer.readUInt32BE(trakOffset)
            if (childSize < 8) break
            const childType = buffer.toString('ascii', trakOffset + 4, trakOffset + 8)

            if (childType === 'tkhd') {
              const version = buffer.readUInt8(trakOffset + 8)
              // tkhd header: 8 (box header) + 1 (version) + 3 (flags)
              let dimOffset: number
              if (version === 1) {
                // version 1 has 64-bit timestamps
                dimOffset = trakOffset + 8 + 1 + 3 + 8 + 8 + 4 + 4 + 8 + 8 + 2 + 2 + 2 + 2 + 36
              } else {
                // version 0 has 32-bit timestamps
                dimOffset = trakOffset + 8 + 1 + 3 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36
              }
              if (dimOffset + 8 <= len) {
                const width = buffer.readUInt32BE(dimOffset) >> 16
                const height = buffer.readUInt32BE(dimOffset + 4) >> 16
                if (width > 0 && height > 0) {
                  return { width, height }
                }
              }
            }
            trakOffset += childSize
          }
        }
        moovOffset += subSize
      }
    }

    if (boxSize === 0) break
    offset += boxSize
  }

  return null
}

/**
 * Derive aspect ratio string from video dimensions.
 * Returns one of the values allowed by the CHECK constraint.
 */
function deriveAspectRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '16:9'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(w, h)
  const sw = w / g
  const sh = h / g
  // Map to allowed values
  if (Math.abs(sw / sh - 9 / 16) < 0.1) return '9:16'
  if (Math.abs(sw / sh - 1) < 0.1) return '1:1'
  if (Math.abs(sw / sh - 4 / 3) < 0.1) return '4:3'
  if (Math.abs(sw / sh - 3 / 4) < 0.1) return '3:4'
  return '16:9' // default
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await params

  console.log(`[video-ai] Status check for jobId: ${jobId}`)

  try {
    const decodedJobId = decodeURIComponent(jobId)
    console.log(`[video-ai] Decoded jobId: ${decodedJobId}`)

    const config = getConfig()

    console.log(`[video-ai] Getting access token for status check...`)
    const { GoogleAuth } = require('google-auth-library')
    const auth = new GoogleAuth({
      keyFilename: config.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const client = await auth.getClient()
    const accessToken = (await client.getAccessToken()).token
    console.log(`[video-ai] Access token obtained for status check`)

    let pollData: any = null
    let pollingStrategy = 'none'

    // Strategy 1: Use fetchPredictOperation (Veo-specific endpoint)
    try {
      const fetchPredictUrl = getOperationEndpoint(decodedJobId)
      console.log(`[video-ai] Strategy 1 - fetchPredictOperation: ${fetchPredictUrl}`)

      const pollRes = await fetch(fetchPredictUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationName: decodedJobId
        }),
      })
      console.log(`[video-ai] fetchPredictOperation status: ${pollRes.status}`)

      if (pollRes.ok) {
        pollData = await pollRes.json()
        pollingStrategy = 'fetchPredictOperation'
        console.log('[video-ai] fetchPredictOperation full response:', JSON.stringify(pollData, null, 2))
        // Log top-level field names to help debug response structure
        if (pollData && typeof pollData === 'object') {
          console.log('[video-ai] response top-level keys:', Object.keys(pollData))
          const inner = pollData.operation || pollData // some endpoints wrap
          if (inner !== pollData) {
            console.log('[video-ai] unwrapped operation keys:', Object.keys(inner))
          }
          const resp = inner.response || inner
          if (resp && typeof resp === 'object' && resp !== inner) {
            console.log('[video-ai] response field keys:', Object.keys(resp))
          }
        }
      } else {
        const errText = await pollRes.text()
        console.warn(`[video-ai] fetchPredictOperation failed (${pollRes.status}): ${errText}`)
      }
    } catch (fetchPredictErr: any) {
      console.warn(`[video-ai] fetchPredictOperation threw: ${fetchPredictErr.message}`)
    }

    // Strategy 2: Standard LRO GET endpoint as fallback
    if (!pollData) {
      try {
        const lroUrl = `https://${config.location}-aiplatform.googleapis.com/v1/${decodedJobId}`
        console.log(`[video-ai] Strategy 2 - Standard LRO GET: ${lroUrl}`)

        const lroRes = await fetch(lroUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` },
        })
        console.log(`[video-ai] LRO GET status: ${lroRes.status}`)

        if (lroRes.ok) {
          pollData = await lroRes.json()
          pollingStrategy = 'lroGet'
          console.log('[video-ai] LRO GET full response:', JSON.stringify(pollData, null, 2))
          if (pollData && typeof pollData === 'object') {
            console.log('[video-ai] LRO GET top-level keys:', Object.keys(pollData))
            const resp = pollData.response || pollData
            if (resp && typeof resp === 'object' && resp !== pollData) {
              console.log('[video-ai] LRO response field keys:', Object.keys(resp))
            }
          }
        } else {
          const errText = await lroRes.text()
          console.error(`[video-ai] LRO GET also failed (${lroRes.status}): ${errText}`)
          throw new Error(`Both polling strategies failed. LRO GET error (${lroRes.status}): ${errText}`)
        }
      } catch (lroErr: any) {
        throw new Error(`All polling strategies exhausted: ${lroErr.message}`)
      }
    }

    // Interpret Vertex AI long-running operation status
    const operationStatus = pollData.done
      ? (pollData.error ? 'failed' : 'completed')
      : 'processing'

    console.log(`[video-ai] Resolved operation status: ${operationStatus} (polling strategy: ${pollingStrategy})`)

    if (operationStatus === 'completed') {
      // DIAGNOSTIC: step-by-step inspection of the response structure
      console.log('[video-ai] DIAG: pollData type:', typeof pollData)
      console.log('[video-ai] DIAG: pollData keys:', pollData ? Object.keys(pollData) : 'N/A')
      const resp = pollData?.response
      console.log('[video-ai] DIAG: response type:', typeof resp)
      if (resp) {
        console.log('[video-ai] DIAG: response keys:', Object.keys(resp))
        console.log('[video-ai] DIAG: response @type:', resp['@type'])
        console.log('[video-ai] DIAG: videos type:', typeof resp.videos)
        console.log('[video-ai] DIAG: videos isArray:', Array.isArray(resp.videos))
        console.log('[video-ai] DIAG: videos length:', resp.videos?.length)
        const video0 = resp.videos?.[0]
        if (video0) {
          console.log('[video-ai] DIAG: video0 keys:', Object.keys(video0))
          console.log('[video-ai] DIAG: video0.bytesBase64Encoded type:', typeof video0.bytesBase64Encoded)
          console.log('[video-ai] DIAG: video0.bytesBase64Encoded length:', typeof video0.bytesBase64Encoded === 'string' ? video0.bytesBase64Encoded.length : 'N/A')
          console.log('[video-ai] DIAG: video0.bytesBase64Encoded first 30:', typeof video0.bytesBase64Encoded === 'string' ? video0.bytesBase64Encoded.substring(0, 30) : 'N/A')
          console.log('[video-ai] DIAG: video0.mimeType:', video0.mimeType)
          console.log('[video-ai] DIAG: video0.gcsUri:', video0.gcsUri)
        }
      }
      // Also check if data is at operation.response instead of response
      const wrappedResp = pollData?.operation?.response
      if (wrappedResp) {
        console.log('[video-ai] DIAG: operation.response exists with keys:', Object.keys(wrappedResp))
        console.log('[video-ai] DIAG: operation.response videos:', wrappedResp.videos ? 'EXISTS' : 'NULL')
      }

      let videoUrl: string | null = null
      let fileBuffer: Buffer | null = null
      let detectedMime = 'video/mp4'

      // Strategy A: extract base64 video from videos[0] (Veo 2.0 GenerateVideoResponse)
      // Response structure: { videos: [{ bytesBase64Encoded: string, mimeType: string }] }
      const firstVideo = pollData?.response?.videos?.[0]
      const encodedVideo: string | null = firstVideo?.bytesBase64Encoded || null
      const inlineMimeType: string | null = firstVideo?.mimeType || null

      console.log(`[video-ai] Inline encodedVideo present: ${!!encodedVideo}`)
      console.log(`[video-ai] Inline mimeType: ${inlineMimeType}`)
      if (encodedVideo) {
        console.log(`[video-ai] encodedVideo length (chars): ${encodedVideo.length}`)
      }

      // Strategy B: extract GCS URI from Vertex AI response (legacy paths)
      const gcsUri: string | null =
        pollData?.response?.videos?.[0]?.gcsUri ||
        pollData?.response?.videos?.[0]?.uri ||
        pollData?.response?.videos?.[0]?.bytesBase64Encoded || // already handled above, keep for consistency
        pollData?.response?.predictions?.[0]?.gcsUri ||
        pollData?.response?.predictions?.[0]?.uri ||
        pollData?.response?.predictions?.[0]?.video?.uri ||
        pollData?.response?.predictions?.[0]?.payload?.gcsUri ||
        pollData?.response?.predictions?.[0]?.payload?.videoUri ||
        pollData?.response?.generated_videos?.[0]?.video?.uri ||
        pollData?.response?.generated_videos?.[0]?.video?.url ||
        pollData?.response?.generated_videos?.[0]?.gcsUri ||
        pollData?.response?.generated_videos?.[0]?.uri ||
        pollData?.response?.generatedVideos?.[0]?.video?.uri ||
        pollData?.response?.generatedVideos?.[0]?.video?.url ||
        pollData?.response?.generatedVideos?.[0]?.gcsUri ||
        pollData?.response?.generatedVideos?.[0]?.uri ||
        pollData?.response?.outputUri ||
        pollData?.metadata?.videos?.[0]?.gcsUri ||
        pollData?.metadata?.generated_videos?.[0]?.video?.uri ||
        pollData?.metadata?.outputUri ||
        pollData?.metadata?.artifactUri ||
        null

      console.log(`[video-ai] Extracted GCS URI: "${gcsUri}"`)

      // Priority 1: inline base64-encoded video (Veo 2.0 direct response)
      if (encodedVideo) {
        try {
          detectedMime = inlineMimeType || 'video/mp4'
          console.log(`[video-ai] Decoding inline base64 video (mime: ${detectedMime})...`)
          fileBuffer = Buffer.from(encodedVideo, 'base64')
          console.log(`[video-ai] Decoded buffer size: ${fileBuffer.length} bytes`)
          if (fileBuffer.length === 0) {
            throw new Error('Decoded base64 video is 0 bytes')
          }
          const magicMime = detectMimeFromBuffer(fileBuffer)
          console.log(`[video-ai] Magic-byte MIME: ${magicMime} (declared: ${detectedMime})`)
        } catch (decodeErr: any) {
          console.error(`[video-ai] Failed to decode inline video:`, decodeErr.message)
          fileBuffer = null
        }
      }

      // Priority 2: download from GCS (only if no inline payload)
      if (!fileBuffer && gcsUri && typeof gcsUri === 'string' && gcsUri.startsWith('gs://')) {
        try {
          const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/)
          if (match) {
            const gcsBucketName = match[1]
            const gcsFileName = match[2]

            const { Storage } = require('@google-cloud/storage')
            const gcsStorage = new Storage({
              keyFilename: config.credentialsPath,
            })

            console.log(`[video-ai] Downloading video from GCS bucket=${gcsBucketName} file=${gcsFileName}`)

            try {
              const [metadata] = await gcsStorage.bucket(gcsBucketName).file(gcsFileName).getMetadata()
              console.log(`[video-ai] GCS file metadata:`, JSON.stringify({
                size: metadata.size,
                contentType: metadata.contentType,
                contentEncoding: metadata.contentEncoding,
                md5Hash: metadata.md5Hash,
                updated: metadata.updated,
              }, null, 2))
            } catch (metaErr: any) {
              console.warn(`[video-ai] Could not get GCS file metadata:`, metaErr.message)
            }

            const [downloadedBuffer] = await gcsStorage.bucket(gcsBucketName).file(gcsFileName).download()
            fileBuffer = downloadedBuffer
            if (!fileBuffer) {
              throw new Error('Downloaded buffer is null')
            }
            detectedMime = detectMimeFromBuffer(fileBuffer)
            console.log(`[video-ai] Downloaded buffer size: ${fileBuffer.length} bytes`)
            console.log(`[video-ai] Buffer first 16 bytes (hex): ${fileBuffer.subarray(0, 16).toString('hex')}`)
            console.log(`[video-ai] Detected MIME type from magic bytes: ${detectedMime}`)

            if (fileBuffer.length === 0) {
              throw new Error('Downloaded file is 0 bytes — video file is empty')
            }
          } else {
            console.error(`[video-ai] Failed to parse gs:// URI: ${gcsUri}`)
          }
        } catch (storageError: any) {
          console.error('[video-ai] Failed to download video from GCS:', storageError)
          throw storageError
        }
      } else if (!fileBuffer && !gcsUri) {
        console.warn('[video-ai] No video data found in completed response')
      }

      // Upload buffer to Supabase Storage (shared by both strategies)
      let storageMetadata: {
        storage_provider: string
        storage_bucket: string
        storage_path: string
        source_uri: string | null
        mime_type: string
        size: number
      } | null = null

      if (fileBuffer && !videoUrl) {
        console.log('[video-ai] Starting video upload to Supabase Storage...')
        try {
          const existingVideo = await findOne('videos', { job_id: decodedJobId })
          const videoId = existingVideo ? existingVideo.id : uuidv4()
          const userId = existingVideo?.user_id || user.id
          const supabasePath = `${userId}/${videoId}.mp4`
          const supabaseBucket = 'generated-videos'

          console.log(`[video-ai] Uploading to bucket: ${supabaseBucket}`)
          console.log(`[video-ai] Storage path: ${supabasePath}`)
          console.log(`[video-ai] Content type: ${detectedMime}`)
          console.log(`[video-ai] Buffer size: ${fileBuffer.length} bytes`)

          const publicUrl = await uploadToStorage(supabaseBucket, supabasePath, fileBuffer, {
            contentType: detectedMime,
            cacheControl: 'public, max-age=31536000',
          })
          console.log(`[video-ai] Upload completed successfully`)
          console.log(`[video-ai] Final URL: ${publicUrl}`)

          try {
            const verifyRes = await fetch(publicUrl, { method: 'HEAD' })
            console.log(`[video-ai] Verify upload HEAD status: ${verifyRes.status}`)
            console.log(`[video-ai] Verify upload content-type: ${verifyRes.headers.get('content-type')}`)
            console.log(`[video-ai] Verify upload content-length: ${verifyRes.headers.get('content-length')}`)
          } catch (verifyErr: any) {
            console.warn(`[video-ai] Upload verification HEAD failed:`, verifyErr.message)
          }

          videoUrl = publicUrl

          storageMetadata = {
            storage_provider: 'supabase',
            storage_bucket: supabaseBucket,
            storage_path: supabasePath,
            source_uri: gcsUri || null,
            mime_type: detectedMime,
            size: fileBuffer.length,
          }
          console.log(`[video-ai] Storage metadata saved: provider=${storageMetadata.storage_provider}, bucket=${storageMetadata.storage_bucket}, path=${storageMetadata.storage_path}`)

          // Cleanup GCS file if we downloaded from GCS
          if (gcsUri && typeof gcsUri === 'string' && gcsUri.startsWith('gs://')) {
            try {
              const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/)
              if (match) {
                const { Storage } = require('@google-cloud/storage')
                const gcsStorage = new Storage({ keyFilename: config.credentialsPath })
                console.log(`[video-ai] Deleting temporary GCS file: ${gcsUri}`)
                await gcsStorage.bucket(match[1]).file(match[2]).delete()
                console.log(`[video-ai] Deleted temporary GCS file successfully`)
              }
            } catch (deleteError: any) {
              console.warn(`[video-ai] Failed to delete temporary GCS file:`, deleteError.message)
            }
          }
        } catch (uploadError: any) {
          console.error('[video-ai] Upload to Supabase failed:', uploadError.message)
          throw uploadError
        }
      }

      try {
        const existingVideo = await findOne('videos', { job_id: decodedJobId })
        console.log('[video-ai] Existing video record before update:', {
          id: existingVideo?.id,
          aspect_ratio: existingVideo?.aspect_ratio,
          resolution: existingVideo?.resolution,
        })

        // Detect dimensions from buffer for aspect ratio correction
        const dims = fileBuffer ? detectVideoDimensions(fileBuffer) : null
        const correctRatio = dims ? deriveAspectRatio(dims.width, dims.height) : undefined

        await updateOne(
          'videos',
          { job_id: decodedJobId },
          {
            status: 'completed',
            video_url: videoUrl ?? null,
            ...(correctRatio ? { aspect_ratio: correctRatio } : {}),
            ...(dims ? { video_width: dims.width, video_height: dims.height } : {}),
            ...(storageMetadata || {}),
          }
        )
        console.log(`[video-ai] DB updated: status=completed, video_url=${videoUrl ?? '(null)'}`)
        if (storageMetadata) {
          console.log(`[video-ai] DB updated with storage metadata`)
        }
      } catch (dbErr) {
        console.error('[video-ai] Failed to update completed status in DB:', dbErr)
      }

      const responsePayload = { status: 'completed', videoUrl: videoUrl ?? null }
      console.log(`[video-ai] Returning to frontend:`, JSON.stringify(responsePayload))
      console.log(`[video-ai] videoUrl value:`, videoUrl)
      console.log(`[video-ai] videoUrl type:`, typeof videoUrl)
      console.log(`[video-ai] videoUrl length:`, videoUrl?.length)
      return NextResponse.json(responsePayload)
    }

    if (operationStatus === 'failed') {
      const errorDetail = pollData.error
        ? `${pollData.error.message || ''} (code: ${pollData.error.code || 'unknown'})`
        : 'Unknown error'
      console.error(`[video-ai] Operation failed: ${errorDetail}`)

      try {
        const existingVideo = await findOne('videos', { job_id: decodedJobId })
        await updateOne('videos', { job_id: decodedJobId }, { status: 'failed' })
        if (
          existingVideo?.user_id === user.id &&
          existingVideo.status !== 'failed' &&
          Number(existingVideo.coins_used ?? 0) > 0
        ) {
          await creditUserCoins(user.id, Number(existingVideo.coins_used))
          console.log(`[video-ai] Refunded ${existingVideo.coins_used} coins to user ${user.id}`)
        }
      } catch (dbErr) {
        console.error('[video-ai] Failed to update failed status in DB:', dbErr)
      }
      return NextResponse.json({ status: 'failed', detail: errorDetail })
    }

    return NextResponse.json({ status: 'processing' })

  } catch (error: any) {
    console.error('[video-ai] Status check error:', error)
    return NextResponse.json({ error: 'Failed to check video status', detail: String(error) }, { status: 502 })
  }
}
