import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { insert, findOne, find, updateOne, deleteOne } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'
import { deductUserCoins, ensureUserHasCoins, getVideoCoinCost } from '@/lib/coins'
import { generateVideoWithVertex } from '@/lib/video-generation'

/**
 * GET /api/video-sessions
 * Get all active editing sessions for the current user
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const sessions = await find('video_sessions', { user_id: user.id, status: 'editing' }, {
      orderBy: 'created_at',
      ascending: false,
    })

    return NextResponse.json({ sessions })
  } catch (error: any) {
    // If table doesn't exist, return empty sessions array instead of error
    // This allows the app to work normally before the migration is run
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      console.warn('[video-sessions] Table does not exist yet, returning empty sessions')
      return NextResponse.json({ sessions: [] })
    }
    console.error('[video-sessions] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }
}

/**
 * POST /api/video-sessions
 * Create a new editing session and generate initial video
 */
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const {
      prompt,
      resolution = '480p',
      aspect_ratio = '16:9',
      duration = 30,
      model = 'text-to-video',
      source_image_url,
    } = await req.json()

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

    const sessionId = uuidv4()
    const session = {
      id: sessionId,
      user_id: user.id,
      original_prompt: prompt,
      current_prompt: prompt,
      current_version: 1,
      coins_used: coinsUsed,
      status: 'editing',
      resolution,
      aspect_ratio,
      duration,
      model,
      source_image_url,
      draft_video_path: null,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
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
      await insert('video_sessions', session)
    } catch (dbError: any) {
      // If table doesn't exist, refund coins and return error
      if (dbError.code === 'PGRST205' || dbError.message?.includes('Could not find the table')) {
        await deductUserCoins(user.id, coinsUsed).catch(() => null)
        return NextResponse.json(
          { error: 'Video sessions table not found. Please run the database migration.' },
          { status: 503 }
        )
      }
      await deductUserCoins(user.id, coinsUsed).catch(() => null)
      throw dbError
    }

    // Start video generation (Version 1) - non-blocking
    let jobId: string | null = null
    try {
      console.log('[video-sessions] Starting initial video generation for session')
      const result = await generateVideoWithVertex(
        prompt,
        resolution,
        aspect_ratio,
        duration,
        model,
        source_image_url
      )
      jobId = result.jobId
      console.log('[video-sessions] Generation started, jobId:', jobId)
    } catch (genError: any) {
      console.error('[video-sessions] Failed to start video generation:', genError)
      // Refund coins on failure
      await deductUserCoins(user.id, coinsUsed).catch(() => null)
      
      // Mark session as failed
      await updateOne('video_sessions', { id: sessionId }, {
        status: 'cancelled',
      })
      
      return NextResponse.json(
        { error: `Failed to start video generation: ${genError.message}` },
        { status: 502 }
      )
    }

    // Create version 1 record with job_id
    const version1 = {
      id: uuidv4(),
      session_id: sessionId,
      version_number: 1,
      prompt,
      draft_video_path: null,
      job_id: jobId,
      status: 'draft',
      created_at: new Date(),
    }
    await insert('video_session_versions', version1)

    // Update session with job_id
    const updatedSession = await updateOne(
      'video_sessions',
      { id: sessionId },
      {
        updated_at: new Date(),
      }
    )

    return NextResponse.json({ session: updatedSession, coins: remainingCoins }, { status: 201 })
  } catch (error: any) {
    console.error('[video-sessions] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
