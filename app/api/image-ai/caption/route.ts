import { NextRequest, NextResponse } from 'next/server'
import { updateOne } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'

function detectLanguage(prompt: string): 'indonesian' | 'english' {
  const indonesianIndicators = ['yang', 'dan', 'di', 'untuk', 'dengan', 'adalah', 'ini', 'itu', 'ke', 'dari', 'pada']
  const hasIndonesian = indonesianIndicators.some(word => prompt.toLowerCase().includes(word))
  return hasIndonesian ? 'indonesian' : 'english'
}

function generateFallbackCaption(prompt: string): string {
  const lang = detectLanguage(prompt)
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const candidates = words.filter(w => !['yang', 'dengan', 'untuk', 'tidak', 'adalah', 'dalam', 'sebuah', 'seperti', 'ketika', 'setelah', 'before', 'after', 'with', 'from', 'that', 'this', 'into', 'about', 'would', 'could', 'should', 'their', 'there', 'which'].includes(w))
  const tags = [...new Set(candidates.slice(0, 5))]
  const hashtags = tags.map(t => `#${t.replace(/[^a-zA-Z0-9]/g, '')}`).join(' ')

  if (lang === 'indonesian') {
    return `Cek gambarnya! 🔥\n\n${hashtags}`
  }
  return `Check this out! 🔥\n\n${hashtags}`
}

function buildSystemPrompt(platform: string): string {
  return `You are a social media content creator writing captions for ${platform}. Your captions must feel authentic and human-written, not AI-generated.

CRITICAL RULES:
1. The IMAGE is your primary source of truth. Analyze what is actually visible in the image first.
2. The text prompt only provides extra context if something cannot be inferred from the image.
3. Describe specific details visible in the image: people, clothing, activities, location, objects, mood, lighting.
4. Write naturally like a real social media creator, not an AI assistant.
5. NEVER use generic phrases like: "Sun-kissed", "Beautiful moments", "Enjoying life", "Check this out", "Living my best life", "Every picture tells a story", "Soaking in the beauty", "Good vibes", "Making memories".

OUTPUT FORMAT:
- 1 engaging caption (2-4 sentences)
- 5-8 relevant hashtags based on the actual image content
- Emojis only where they feel natural and appropriate

CONTENT-SPECIFIC GUIDELINES:
- If the image contains PEOPLE: Mention what they are doing, their expressions, and the context.
- If the image is a PRODUCT: Create a marketing caption that highlights features/benefits naturally.
- If the image is FOOD: Create a foodie caption describing the dish, flavors, or dining experience.
- If the image is a LANDSCAPE: Create a travel caption describing the location and atmosphere.
- If the image is a MEME: Create a funny, relatable caption that matches the humor.

Return ONLY the caption with hashtags. No explanations, no meta-commentary.`
}

function buildUserPrompt(prompt: string, platform: string): string {
  return `Original prompt: "${prompt}"

Generate a ${platform} caption for this image.`
}

async function callCaptionAPI(
  apiUrl: string,
  apiKey: string,
  model: string,
  systemContent: string,
  userMessages: any[],
  maxTokens: number,
  reasoningEffort?: string
): Promise<{ caption: string; usage: any; finishReason: string }> {
  const messages: any[] = [
    { role: 'system', content: systemContent },
    ...userMessages,
  ]

  const requestBody: any = {
    model,
    messages,
    max_tokens: maxTokens,
  }
  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort
  }

  console.log('[image-ai] Caption API call:', {
    model,
    maxTokens,
    reasoningEffort,
    systemPromptLength: systemContent.length,
    userMessageCount: userMessages.length,
  })

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await response.text()
  console.log('[image-ai] Caption API response status:', response.status)

  let data
  try {
    data = JSON.parse(responseText)
  } catch (parseError) {
    console.error('[image-ai] Failed to parse API response as JSON:', parseError)
    console.error('[image-ai] Raw response text:', responseText)
    throw new Error(`Invalid JSON (HTTP ${response.status})`)
  }

  if (data?.error) {
    const errMsg = data.error?.message || JSON.stringify(data.error)
    throw new Error(`API error: ${errMsg}`)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 300)}`)
  }

  const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown'
  const content: string | null = data?.choices?.[0]?.message?.content ?? null
  const usage = data?.usage ?? null

  return { caption: content ?? '', usage, finishReason }
}

export async function POST(req: NextRequest) {
  console.log('[image-ai] Caption API - POST request received')
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { imageUrl, prompt, imageId, platform = 'instagram' } = await req.json()
    console.log('[image-ai] Caption API - request body:', { imageUrl: imageUrl?.slice(0, 50) + '...', prompt, imageId, platform })

    const CAPTION_API_KEY = process.env.CAPTION_API_KEY
    const CAPTION_API_URL = process.env.CAPTION_API_URL
    const CAPTION_MODEL = process.env.CAPTION_MODEL || 'utero/carubra-6.2.1'

    let caption: string
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null

    if (CAPTION_API_KEY && CAPTION_API_URL) {
      try {
        const systemPrompt = buildSystemPrompt(platform)
        const userMessages: any[] = imageUrl
          ? [{ role: 'user', content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: buildUserPrompt(prompt, platform) },
            ]}]
          : [{ role: 'user', content: buildUserPrompt(prompt, platform) }]

        const result = await callCaptionAPI(
          CAPTION_API_URL,
          CAPTION_API_KEY,
          CAPTION_MODEL,
          systemPrompt,
          userMessages,
          800,
          'low'
        )

        caption = result.caption
        usage = result.usage

        console.log('[image-ai] Caption attempt 1:', {
          finishReason: result.finishReason,
          captionLength: caption.length,
        })

        if (result.finishReason === 'length' || !caption) {
          console.log('[image-ai] Caption truncated/length exceeded, retrying with minimal prompt...')

          const retrySystem = `You are a social media content creator writing captions for Instagram. Your captions must feel authentic and human-written, not AI-generated.

CRITICAL RULES:
1. The IMAGE is your primary source of truth. Analyze what is actually visible in the image first.
2. The text prompt only provides extra context if something cannot be inferred from the image.
3. Describe specific details visible in the image: people, clothing, activities, location, objects, mood, lighting.
4. Write naturally like a real social media creator, not an AI assistant.
5. NEVER use generic phrases like: "Sun-kissed", "Beautiful moments", "Enjoying life", "Check this out", "Living my best life", "Every picture tells a story", "Soaking in the beauty", "Good vibes", "Making memories".

OUTPUT FORMAT:
- 1 engaging caption (2-4 sentences)
- 5-8 relevant hashtags based on the actual image content
- Emojis only where they feel natural and appropriate

Return ONLY the caption with hashtags. No explanations, no meta-commentary.`
          const retryMessages: any[] = imageUrl
            ? [{ role: 'user', content: [
                { type: 'image_url', image_url: { url: imageUrl } },
                { type: 'text', text: `Prompt: ${prompt.slice(0, 200)}` },
              ]}]
            : [{ role: 'user', content: `Prompt: ${prompt.slice(0, 200)}` }]

          const retryResult = await callCaptionAPI(
            CAPTION_API_URL,
            CAPTION_API_KEY,
            CAPTION_MODEL,
            retrySystem,
            retryMessages,
            800,
            'low'
          )

          console.log('[image-ai] Caption retry result:', {
            finishReason: retryResult.finishReason,
            captionLength: retryResult.caption.length,
            hasCaption: !!retryResult.caption,
          })

          if (retryResult.caption && retryResult.finishReason !== 'length') {
            caption = retryResult.caption
            usage = retryResult.usage || usage
          } else {
            console.log('[image-ai] Both caption attempts failed, using fallback template')
            caption = generateFallbackCaption(prompt)
            usage = null
          }
        }
      } catch (apiError) {
        console.error('[image-ai] Caption API failed entirely:', apiError)
        caption = generateFallbackCaption(prompt)
        usage = null
      }
    } else {
      caption = generateFallbackCaption(prompt)
      usage = null
    }

    if (imageId) {
      try {
        await updateOne('images', { id: imageId }, { caption })
      } catch (dbError) {
        console.error('[image-ai] Failed to update caption in DB:', dbError)
      }
    }

    return NextResponse.json({ caption, usage })
  } catch (error: any) {
    console.error('[image-ai] Caption endpoint error:', error)
    return NextResponse.json({ caption: generateFallbackCaption(''), usage: null })
  }
}
