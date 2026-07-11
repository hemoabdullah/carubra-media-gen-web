import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { insert } from '@/lib/supabase'
import { creditUserCoins, deductUserCoins, ensureUserHasCoins, getVideoCoinCost } from '@/lib/coins'
import { getUserFromRequest } from '@/middleware/auth'
import { validateVertexConfig, getVideoGenerationEndpoint, getConfig } from '@/lib/vertex'

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { prompt, style, duration, resolution = '480p', init_image } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const coinsUsed = getVideoCoinCost(resolution)
    try {
      await ensureUserHasCoins(user.id, coinsUsed)
    } catch (coinError: any) {
      return NextResponse.json(
        { error: coinError.message ?? 'Insufficient coins' },
        { status: coinError.status ?? 500 }
      )
    }

    // Validate Vertex AI configuration
    try {
      validateVertexConfig()
    } catch (configError: any) {
      return NextResponse.json({ error: configError.message }, { status: 500 })
    }

    // Map quality / resolution to support DB constraint ('480p', '720p') and Veo max
    let dbResolution = '480p'
    if (resolution === '720p' || resolution === '1080p' || resolution === '2K') {
      dbResolution = '720p'
    }

    // Map style / aspect ratio to DB constraint and Vertex AI supported options
    let dbAspectRatio = '16:9'
    let providerAspectRatio = '16:9'

    if (style) {
      const norm = style.replace('-', ':')
      console.log(`[video-ai] Style input: "${style}", normalized: "${norm}"`)
      if (norm === '9:16' || norm === '3:4') {
        dbAspectRatio = '9:16'
        providerAspectRatio = '9:16'
      } else if (norm === '1:1') {
        dbAspectRatio = '1:1'
        providerAspectRatio = '16:9' // Veo 2.0 fallback
      } else {
        dbAspectRatio = '16:9'
        providerAspectRatio = '16:9'
      }
    }

    console.log(`[video-ai] Aspect ratio mapping - input style: "${style}", dbAspectRatio: "${dbAspectRatio}", providerAspectRatio: "${providerAspectRatio}"`)

    const newVideo = {
      id: uuidv4(),
      user_id: user.id,
      prompt,
      model: init_image ? 'image-to-video' : 'text-to-video',
      resolution: dbResolution,
      aspect_ratio: dbAspectRatio,
      duration,
      coins_used: coinsUsed,
      status: 'processing',
      created_at: new Date(),
    }

    try {
      console.log(`[video-ai] Calling Vertex AI with prompt: ${prompt}, Aspect Ratio: ${providerAspectRatio}`)

      let jobId: string
      try {
        const endpoint = getVideoGenerationEndpoint()
        const config = getConfig()
        const outputGcsUri = config.outputGcsUri
        
        if (!outputGcsUri) {
          throw new Error('VERTEX_OUTPUT_GCS_URI environment variable is required')
        }

        // Prepare Vertex AI REST API request
        const requestBody = {
          instances: [
            {
              prompt: prompt,
              ...(init_image ? {
                image: {
                  bytesBase64Encoded: init_image,
                  mimeType: "image/jpeg" // Default to JPEG for image-to-video
                }
              } : {}),
            }
          ],
          parameters: {
            outputGcsUri: outputGcsUri,
            sampleCount: 1,
            ...(providerAspectRatio ? { aspectRatios: [providerAspectRatio] } : {}),
          }
        }

        console.log(`[video-ai] Image-to-video mode: ${init_image ? 'YES' : 'NO'}`)
        console.log(`[video-ai] Init image length: ${init_image ? init_image.length : 0}`)

        console.log(`[video-ai] Vertex AI endpoint: ${endpoint}`)
        console.log(`[video-ai] Request body: ${JSON.stringify(requestBody)}`)

        // Get Google Cloud access token
        console.log(`[video-ai] Getting Google Cloud access token...`)
        console.log(`[video-ai] Using credentials path: ${config.credentialsPath}`)
        let accessToken: string
        try {
          const { GoogleAuth } = require('google-auth-library')
          const auth = new GoogleAuth({
            keyFilename: config.credentialsPath,
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
          })
          const client = await auth.getClient()
          accessToken = (await client.getAccessToken()).token
          console.log(`[video-ai] Access token obtained successfully`)
        } catch (authError: any) {
          console.error(`[video-ai] Authentication error:`, authError)
          throw new Error(`Failed to get Google Cloud access token: ${authError.message}`)
        }

        // Call Vertex AI REST API
        console.log(`[video-ai] Calling Vertex AI API...`)
        let response: Response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          })
        } catch (fetchError: any) {
          console.error(`[video-ai] Fetch error:`, fetchError)
          throw new Error(`Network error calling Vertex AI: ${fetchError.message}`)
        }

        console.log(`[video-ai] Vertex AI response status: ${response.status}`)
        const responseText = await response.text()
        console.log(`[video-ai] Vertex AI response body: ${responseText.slice(0, 1000)}`)

        let responseData
        try {
          responseData = JSON.parse(responseText)
        } catch {
          responseData = { raw: responseText }
        }

        if (!response.ok) {
          throw new Error(`Vertex AI API error (${response.status}): ${JSON.stringify(responseData)}`)
        }

        // Extract operation name (job ID) from response
        const operationName = responseData.name || responseData.operation?.name
        if (!operationName) {
          // If no operation name returned, use our UUID as the job ID
          jobId = newVideo.id
          console.log(`[video-ai] Vertex AI did not return operation name, using local ID: ${jobId}`)
        } else {
          jobId = operationName
          console.log(`[video-ai] Vertex AI returned operation name: ${jobId}`)
        }
      } catch (vertexError: any) {
        console.error('[video-ai] Vertex AI error:', vertexError)
        console.error('[video-ai] Error message:', vertexError.message)
        console.error('[video-ai] Error stack:', vertexError.stack)
        newVideo.status = 'failed'
        await insert('videos', newVideo)

        // Handle Vertex AI specific errors
        const errorMessage = vertexError.message || String(vertexError)
        
        if (errorMessage.includes('authentication') || errorMessage.includes('credentials') || errorMessage.includes('UNAUTHENTICATED') || errorMessage.includes('invalid_grant')) {
          return NextResponse.json(
            { error: 'Vertex AI authentication failed. Check your GOOGLE_APPLICATION_CREDENTIALS.' },
            { status: 401 }
          )
        }
        
        if (errorMessage.includes('quota') || errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('ResourceExhausted')) {
          return NextResponse.json(
            { error: 'Vertex AI quota exceeded. Please check your Google Cloud quota limits.' },
            { status: 429 }
          )
        }
        
        if (errorMessage.includes('model') || errorMessage.includes('MODEL_NOT_FOUND') || errorMessage.includes('not available') || errorMessage.includes('Model not found')) {
          return NextResponse.json(
            { error: 'Vertex AI model unavailable. Check VERTEX_MODEL configuration.' },
            { status: 400 }
          )
        }
        
        if (errorMessage.includes('region') || errorMessage.includes('location') || errorMessage.includes('unsupported') || errorMessage.includes('Invalid location')) {
          return NextResponse.json(
            { error: 'Vertex AI region unsupported. Check VERTEX_LOCATION configuration.' },
            { status: 400 }
          )
        }

        return NextResponse.json(
          { error: 'Video generation failed', detail: errorMessage },
          { status: 502 }
        )
      }

      // Simpan ke DB dengan status processing + jobId
      const finalVideo = {
        ...newVideo,
        job_id: jobId,
        status: 'processing',
      }

      let remainingCoins: number
      try {
        remainingCoins = await deductUserCoins(user.id, coinsUsed)
      } catch (coinError: any) {
        return NextResponse.json(
          { error: coinError.message ?? 'Unable to deduct coins' },
          { status: coinError.status ?? 500 }
        )
      }

      try {
        await insert('videos', finalVideo)
      } catch (dbError) {
        await creditUserCoins(user.id, coinsUsed).catch(() => null)
        throw dbError
      }

      // Return 202
      return NextResponse.json({
        video: {
          id: finalVideo.id,
          jobId,
          status: 'processing',
        },
        coins: remainingCoins,
      }, { status: 202 })

    } catch (error: any) {
      newVideo.status = 'failed'
      console.error('[video-ai] Error:', error)
      try {
        await insert('videos', newVideo)
      } catch {}

      // Detect network / timeout errors and return a clearer message
      const errorMessage = error?.message || String(error)
      
      if (errorMessage.includes('timeout') || errorMessage.includes('AbortError') || errorMessage.includes('ETIMEDOUT')) {
        return NextResponse.json(
          { error: 'Vertex AI request timeout. The video generation took too long to respond.' },
          { status: 504 }
        )
      }
      
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed') || errorMessage.includes('network')) {
        return NextResponse.json(
          { error: 'Vertex AI is unreachable. Check your network connection and Vertex AI configuration.' },
          { status: 503 }
        )
      }

      return NextResponse.json({ error: 'Failed to call Vertex AI', detail: errorMessage }, { status: 502 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
