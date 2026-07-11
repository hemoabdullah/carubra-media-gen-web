import { NextRequest, NextResponse } from 'next/server'
import { findOne, updateOne } from '@/lib/supabase'
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
    return `Cek videonya! 🔥\n\n${hashtags}`
  }
  return `Check this out! 🔥\n\n${hashtags}`
}

function buildSystemPrompt(platform: string): string {
  return `You are a social media caption generator for ${platform}.

Generate ONE caption based on the prompt below.
Return ONLY the caption text.
Include 3-5 relevant hashtags.`
}

function buildUserPrompt(originalPrompt: string, script: string, platform: string): string {
  return `Original prompt: "${originalPrompt}"
Video script: "${script}"

Generate a ${platform} caption for this video.`
}

async function callCaptionAPI(
  apiUrl: string,
  apiKey: string,
  model: string,
  systemContent: string,
  userContent: string,
  maxTokens: number,
  reasoningEffort?: string
): Promise<{ caption: string; usage: any; finishReason: string }> {
  const messages: any[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]

  const requestBody: any = {
    model,
    messages,
    max_tokens: maxTokens,
  }
  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort
  }

  console.log('[video-ai] Caption API call:', {
    model,
    maxTokens,
    reasoningEffort,
    systemPromptLength: systemContent.length,
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
  console.log('[video-ai] Caption API response status:', response.status)

  let data
  try {
    data = JSON.parse(responseText)
  } catch (parseError) {
    console.error('[video-ai] Failed to parse API response as JSON:', parseError)
    console.error('[video-ai] Raw response text:', responseText)
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
  console.log('[video-ai] Caption API - POST request received')
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { script, videoId, platform = 'tiktok' } = await req.json()
    console.log('[video-ai] Caption API - request body:', { script, videoId, platform })

    const CAPTION_API_KEY = process.env.CAPTION_API_KEY
    const CAPTION_API_URL = process.env.CAPTION_API_URL
    const CAPTION_MODEL   = process.env.CAPTION_MODEL || 'utero/carubra-6.2.1'

    let videoRecord = null
    if (videoId) {
      try {
        videoRecord = await findOne('videos', { id: videoId })
      } catch (dbErr) {
        console.error('[video-ai] Failed to fetch video record:', dbErr)
      }
    }

    const originalPrompt = videoRecord?.prompt || script
    const language = detectLanguage(originalPrompt)

    let caption: string
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null

    if (CAPTION_API_KEY && CAPTION_API_URL) {
      try {
        // Attempt 1: standard shortened prompt + large token budget
        const systemPrompt = buildSystemPrompt(platform)
        const userPrompt = buildUserPrompt(originalPrompt, script, platform)

        const result = await callCaptionAPI(
          CAPTION_API_URL,
          CAPTION_API_KEY,
          CAPTION_MODEL,
          systemPrompt,
          userPrompt,
          800,
          'low'
        )

        caption = result.caption
        usage = result.usage

        console.log('[video-ai] Caption attempt 1:', {
          finishReason: result.finishReason,
          captionLength: caption.length,
        })

        // Retry on length truncation with a minimal prompt
        if (result.finishReason === 'length' || !caption) {
          console.log('[video-ai] Caption truncated/length exceeded, retrying with minimal prompt...')

          const retrySystem = `Generate a ${platform} caption. Return only the caption. Include hashtags.`
          const retryUser = `Prompt: ${originalPrompt.slice(0, 200)}`

          const retryResult = await callCaptionAPI(
            CAPTION_API_URL,
            CAPTION_API_KEY,
            CAPTION_MODEL,
            retrySystem,
            retryUser,
            800,
            'low'
          )

          console.log('[video-ai] Caption retry result:', {
            finishReason: retryResult.finishReason,
            captionLength: retryResult.caption.length,
            hasCaption: !!retryResult.caption,
          })

          if (retryResult.caption && retryResult.finishReason !== 'length') {
            caption = retryResult.caption
            usage = retryResult.usage || usage
          } else {
            // Both attempts failed — use local fallback
            console.log('[video-ai] Both caption attempts failed, using fallback template')
            caption = generateFallbackCaption(originalPrompt)
            usage = null
          }
        }
      } catch (apiError) {
        console.error('[video-ai] Caption API failed entirely:', apiError)
        // Fall back to local template — never return 502 for captions
        caption = generateFallbackCaption(originalPrompt)
        usage = null
      }
    } else {
      caption = generateFallbackCaption(originalPrompt)
      usage = null
    }

    if (videoId) {
      try {
        await updateOne('videos', { id: videoId }, { caption })
      } catch (dbError) {
        console.error('[video-ai] Failed to update caption in DB:', dbError)
      }
    }

    return NextResponse.json({ caption, usage })
  } catch (error: any) {
    console.error('[video-ai] Caption endpoint error:', error)
    return NextResponse.json({ caption: generateFallbackCaption(''), usage: null })
  }
}
