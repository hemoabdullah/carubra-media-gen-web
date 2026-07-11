import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { insert, updateOne, uploadToStorage } from '@/lib/supabase'
import { creditUserCoins, deductUserCoins, ensureUserHasCoins, getImageCoinCost } from '@/lib/coins'
import { getUserFromRequest } from '@/middleware/auth'

// Valid size presets supported by OpenAI-compatible image APIs
// Width x Height as supported by most providers
const VALID_SIZES: { w: number; h: number }[] = [
  { w: 1024, h: 1024 }, // 1:1 Square
  { w: 1280, h: 720  }, // 16:9 Widescreen
  { w: 720,  h: 1280 }, // 9:16 Vertical
  { w: 1024, h: 768  }, // 4:3 Standard
  { w: 768,  h: 1024 }, // 3:4 Portrait
  { w: 1440, h: 1440 }, // 2K Square
  { w: 1920, h: 1080 }, // 2K Widescreen
  { w: 1080, h: 1920 }, // 2K Vertical
  { w: 1152, h: 864  }, // fallback
  { w: 864,  h: 1152 }, // fallback
]

/**
 * Convert image URL or base64 to Buffer
 */
async function imageUrlToBuffer(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith('data:')) {
    // Base64 data URL
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new Error('Invalid data URL format')
    const mimeType = match[1]
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')
    return { buffer, mimeType }
  } else {
    // HTTP URL
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type') || 'image/png'
    return { buffer, mimeType }
  }
}

/**
 * Snap requested dimensions to the nearest valid API preset.
 * Matches by aspect ratio first, then by closest area.
 */
function snapToValidSize(width: number, height: number): { width: number; height: number } {
  const requestedRatio = width / height
  let bestSize = VALID_SIZES[0]
  let bestDelta = Infinity

  for (const size of VALID_SIZES) {
    const sizeRatio = size.w / size.h
    const ratioDelta = Math.abs(requestedRatio - sizeRatio)
    // Primary sort: aspect ratio match; secondary: area proximity
    const areaDelta = Math.abs(width * height - size.w * size.h) / (size.w * size.h)
    const combinedDelta = ratioDelta * 10 + areaDelta
    if (combinedDelta < bestDelta) {
      bestDelta = combinedDelta
      bestSize = size
    }
  }

  return { width: bestSize.w, height: bestSize.h }
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const {
      prompt,
      width: rawWidth = 1024,
      height: rawHeight = 1024,
      steps = 4,
      cfg_scale = 1,
      init_image,
      strength,
    } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    if (typeof rawWidth !== 'number' || typeof rawHeight !== 'number') {
      return NextResponse.json({ error: 'Width and height must be numbers' }, { status: 400 })
    }

    // Snap to nearest valid preset to prevent API dimension errors
    const { width, height } = snapToValidSize(rawWidth, rawHeight)
    if (width !== rawWidth || height !== rawHeight) {
      console.log(`[image-ai] Snapped dimensions from ${rawWidth}x${rawHeight} → ${width}x${height}`)
    }

    const coinsUsed = getImageCoinCost(width, height)
    try {
      await ensureUserHasCoins(user.id, coinsUsed)
    } catch (coinError: any) {
      return NextResponse.json(
        { error: coinError.message ?? 'Insufficient coins' },
        { status: coinError.status ?? 500 }
      )
    }

    const IMAGE_API_KEY = process.env.IMAGE_API_KEY
    const IMAGE_API_URL = (process.env.IMAGE_API_URL || '').replace(/\/+$/, '')
    const IMAGE_MODEL = process.env.IMAGE_MODEL || 'carubra/image'

    if (!IMAGE_API_KEY || !IMAGE_API_URL) {
      return NextResponse.json({ error: 'Server is not configured with IMAGE_API_KEY or IMAGE_API_URL' }, { status: 500 })
    }

    const newImage = {
      id: uuidv4(),
      user_id: user.id,
      prompt,
      width,
      height,
      steps,
      cfg_scale,
      status: 'processing',
      coins_used: coinsUsed,
      created_at: new Date(),
    }

    try {
      const isImg2Img = !!init_image
      console.log(`[image-ai] Mode: ${isImg2Img ? 'image-to-image' : 'text-to-image'}`)
      console.log(`[image-ai] Model: ${IMAGE_MODEL}, Prompt: ${prompt}`)
      console.log(`[image-ai] Output dimensions: ${width}x${height}`)

      const controller = new AbortController()
      const timeoutMs = isImg2Img ? 180000 : 90000
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response
      try {
        if (isImg2Img) {
          // ─── Image-to-Image: MUST use /v1/images/edits with multipart/form-data ───
          // The /v1/images/generations endpoint does NOT support image conditioning.
          // Sending init_image as JSON is silently ignored by all major providers.
          console.log(`[image-ai] Using /v1/images/edits endpoint (multipart/form-data)`)
          console.log(`[image-ai] init_image base64 length: ${init_image.length}`)

          // Convert base64 to Buffer → Blob
          const imageBuffer = Buffer.from(init_image, 'base64')
          const imageBlob = new Blob([imageBuffer], { type: 'image/png' })

          const form = new FormData()
          form.append('image', imageBlob, 'source.png')
          form.append('prompt', prompt)
          form.append('model', IMAGE_MODEL)
          form.append('n', '1')
          form.append('size', `${width}x${height}`)
          // strength / cfg: some providers accept these, harmless if ignored
          const appliedStrength = typeof strength === 'number' ? strength : 0.65
          form.append('strength', String(appliedStrength))

          console.log(`[image-ai] Strength: ${appliedStrength}`)

          response = await fetch(`${IMAGE_API_URL}/v1/images/edits`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${IMAGE_API_KEY}`,
              // Do NOT set Content-Type manually — fetch sets it with boundary automatically
            },
            body: form,
            signal: controller.signal,
          })
        } else {
          // ─── Text-to-Image: use /v1/images/generations with JSON ──────────────
          console.log(`[image-ai] Using /v1/images/generations endpoint (JSON)`)

          const payload: Record<string, unknown> = {
            model: IMAGE_MODEL,
            prompt,
            width,
            height,
            steps,
            cfg_scale,
            size: `${width}x${height}`,
            n: 1,
          }

          response = await fetch(`${IMAGE_API_URL}/v1/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${IMAGE_API_KEY}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          })
        }
      } finally {
        clearTimeout(timeout)
      }

      const rawText = await response.text()
      console.log(`[image-ai] Response status: ${response.status}`)

      let carubraData: any
      try {
        carubraData = JSON.parse(rawText)
      } catch {
        carubraData = rawText
      }

      console.log('[image-ai] Provider response body:', carubraData)

      if (!response.ok) {
        // If /v1/images/edits is unsupported (404/405), fall back to /v1/images/generations
        // with init_image in the JSON body (legacy behavior)
        if (isImg2Img && (response.status === 404 || response.status === 405)) {
          console.warn(`[image-ai] /v1/images/edits not supported (${response.status}), falling back to /v1/images/generations with init_image field`)

          const fallbackPayload: Record<string, unknown> = {
            model: IMAGE_MODEL,
            prompt,
            width,
            height,
            steps,
            cfg_scale,
            size: `${width}x${height}`,
            n: 1,
            init_image,
            strength: typeof strength === 'number' ? strength : 0.65,
          }

          const fallbackController = new AbortController()
          const fallbackTimeout = setTimeout(() => fallbackController.abort(), 180000)
          let fallbackResponse: Response
          try {
            fallbackResponse = await fetch(`${IMAGE_API_URL}/v1/images/generations`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${IMAGE_API_KEY}`,
              },
              body: JSON.stringify(fallbackPayload),
              signal: fallbackController.signal,
            })
          } finally {
            clearTimeout(fallbackTimeout)
          }

          const fallbackText = await fallbackResponse.text()
          console.log(`[image-ai] Fallback response status: ${fallbackResponse.status}`)
          let fallbackData: any
          try { fallbackData = JSON.parse(fallbackText) } catch { fallbackData = fallbackText }
          console.log('[image-ai] Fallback response body:', fallbackData)

          if (!fallbackResponse.ok) {
            newImage.status = 'failed'
            await insert('images', newImage)
            return NextResponse.json({ error: 'Image generation failed', detail: fallbackData }, { status: fallbackResponse.status })
          }

          // Use fallback response data
          const fallbackItem = fallbackData?.data?.[0]
          const fallbackUrl: string | null =
            fallbackItem?.url ||
            (fallbackItem?.b64_json ? `data:image/png;base64,${fallbackItem.b64_json}` : null) ||
            (fallbackData?.b64_json ? `data:image/png;base64,${fallbackData.b64_json}` : null) ||
            null

          if (!fallbackUrl) {
            newImage.status = 'failed'
            await insert('images', newImage)
            return NextResponse.json({ error: 'Fallback response did not return a valid image', detail: fallbackData }, { status: 502 })
          }

          // Upload to Supabase Storage (fallback path)
          let finalFallbackUrl = fallbackUrl
          let storageMetadataFallback: {
            storage_provider: string
            storage_bucket: string
            storage_path: string
            source_uri: string
            mime_type: string
            size: number
          } | null = null

          try {
            console.log('[image-ai] Uploading fallback image to Supabase Storage...')
            const { buffer, mimeType } = await imageUrlToBuffer(fallbackUrl)
            const storagePath = `${user.id}/${newImage.id}.png`
            const publicUrl = await uploadToStorage('generated-images', storagePath, buffer, {
              contentType: mimeType,
              cacheControl: 'public, max-age=31536000',
            })
            console.log(`[image-ai] Fallback upload successful: ${publicUrl}`)

            finalFallbackUrl = publicUrl
            storageMetadataFallback = {
              storage_provider: 'supabase',
              storage_bucket: 'generated-images',
              storage_path: storagePath,
              source_uri: fallbackUrl,
              mime_type: mimeType,
              size: buffer.length,
            }
          } catch (uploadError: any) {
            console.error('[image-ai] Failed to upload fallback to Supabase Storage:', uploadError)
          }

          const completedFallback = {
            ...newImage,
            status: 'completed',
            image_url: finalFallbackUrl,
            ...(storageMetadataFallback || {}),
          }
          let remainingCoinsFallback: number
          try {
            remainingCoinsFallback = await deductUserCoins(user.id, coinsUsed)
          } catch (coinError: any) {
            return NextResponse.json({ error: coinError.message ?? 'Unable to deduct coins' }, { status: coinError.status ?? 500 })
          }
          try {
            await insert('images', completedFallback)
          } catch (dbError) {
            await creditUserCoins(user.id, coinsUsed).catch(() => null)
            throw dbError
          }
          return NextResponse.json({ image: { ...completedFallback, imageUrl: finalFallbackUrl }, coins: remainingCoinsFallback }, { status: 201 })
        }

        newImage.status = 'failed'
        await insert('images', newImage)
        return NextResponse.json({ error: 'Image generation failed', detail: carubraData }, { status: response.status })
      }

      const item = carubraData?.data?.[0]
      const imageUrl: string | null =
        item?.url ||
        (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null) ||
        (carubraData?.b64_json ? `data:image/png;base64,${carubraData.b64_json}` : null) ||
        null

      if (!imageUrl) {
        console.warn('[image-ai] No image URL found in provider response')
        newImage.status = 'failed'
        await insert('images', newImage)
        return NextResponse.json({ error: 'Response did not return a valid image', detail: carubraData }, { status: 502 })
      }

      // Upload to Supabase Storage
      let finalImageUrl = imageUrl
      let storageMetadata: {
        storage_provider: string
        storage_bucket: string
        storage_path: string
        source_uri: string
        mime_type: string
        size: number
      } | null = null

      try {
        console.log('[image-ai] Uploading image to Supabase Storage...')
        const { buffer, mimeType } = await imageUrlToBuffer(imageUrl)
        const storagePath = `${user.id}/${newImage.id}.png`
        const publicUrl = await uploadToStorage('generated-images', storagePath, buffer, {
          contentType: mimeType,
          cacheControl: 'public, max-age=31536000',
        })
        console.log(`[image-ai] Upload successful: ${publicUrl}`)

        finalImageUrl = publicUrl
        storageMetadata = {
          storage_provider: 'supabase',
          storage_bucket: 'generated-images',
          storage_path: storagePath,
          source_uri: imageUrl,
          mime_type: mimeType,
          size: buffer.length,
        }
      } catch (uploadError: any) {
        console.error('[image-ai] Failed to upload to Supabase Storage:', uploadError)
        // Continue with original URL if upload fails
      }

      const completedImage = {
        ...newImage,
        status: 'completed',
        image_url: finalImageUrl,
        ...(storageMetadata || {}),
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
        await insert('images', completedImage)
      } catch (dbError) {
        await creditUserCoins(user.id, coinsUsed).catch(() => null)
        throw dbError
      }

      return NextResponse.json({ image: { ...completedImage, imageUrl }, coins: remainingCoins }, { status: 201 })
    } catch (error: any) {
      newImage.status = 'failed'
      console.error('[image-ai] Error:', error)
      try {
        await insert('images', newImage)
      } catch {}

      const isConnectError =
        error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error?.cause?.code === 'ECONNREFUSED' ||
        error?.cause?.code === 'ECONNRESET' ||
        error?.name === 'AbortError' ||
        String(error).includes('fetch failed') ||
        String(error).includes('ConnectTimeout') ||
        String(error).includes('ECONNRESET')

      if (isConnectError) {
        return NextResponse.json(
          {
            error: 'Image generation server is unreachable',
            detail: `Could not connect to ${IMAGE_API_URL}. Please make sure the image server is running and accessible from this machine.`,
          },
          { status: 503 },
        )
      }

      return NextResponse.json({ error: 'Failed to call image API', detail: String(error) }, { status: 502 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
