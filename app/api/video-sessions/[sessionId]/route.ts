import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { findOne, find, updateOne, deleteOne, insert } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'
import { deductUserCoins, ensureUserHasCoins, getVideoCoinCost } from '@/lib/coins'
import { deleteSessionTempVideos, deleteTempVideo } from '@/lib/temp-storage'
import { generateVideoWithVertex } from '@/lib/video-generation'

/**
 * GET /api/video-sessions/[sessionId]
 * Get a specific editing session with its versions
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sessionId } = await params
    const session = await findOne('video_sessions', { id: sessionId, user_id: user.id })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Get versions for this session
    const versions = await find('video_session_versions', { session_id: sessionId }, {
      orderBy: 'version_number',
      ascending: true,
    })

    return NextResponse.json({ session, versions })
  } catch (error: any) {
    console.error('[video-sessions] GET [id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

/**
 * PATCH /api/video-sessions/[sessionId]
 * Update session (edit, regenerate)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sessionId } = await params
    const session = await findOne('video_sessions', { id: sessionId, user_id: user.id })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (session.status !== 'editing') {
      return NextResponse.json({ error: 'Session is not in editing state' }, { status: 400 })
    }

    const { action, prompt, draft_video_path, version_number } = await req.json()

    if (action === 'edit' || action === 'regenerate') {
      console.log('[video-sessions] Processing edit/regenerate action')
      
      // Deduct coins for edit/regenerate
      const coinsUsed = getVideoCoinCost(session.resolution)
      try {
        await ensureUserHasCoins(user.id, coinsUsed)
      } catch (coinError: any) {
        return NextResponse.json(
          { error: coinError.message ?? 'Insufficient coins' },
          { status: coinError.status ?? 500 }
        )
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

      // Create new version record first (with draft status)
      const newVersionNumber = session.current_version + 1
      const newVersion = {
        id: uuidv4(),
        session_id: sessionId,
        version_number: newVersionNumber,
        prompt: prompt || session.current_prompt,
        draft_video_path: null,
        job_id: null,
        status: 'draft',
        created_at: new Date(),
      }

      await insert('video_session_versions', newVersion)

      // Start video generation (non-blocking)
      let jobId: string | null = null
      try {
        console.log('[video-sessions] Starting video generation for edit')
        const result = await generateVideoWithVertex(
          prompt || session.current_prompt,
          session.resolution,
          session.aspect_ratio,
          session.duration,
          session.model,
          session.source_image_url
        )
        jobId = result.jobId
        console.log('[video-sessions] Generation started, jobId:', jobId)
      } catch (genError: any) {
        console.error('[video-sessions] Failed to start video generation:', genError)
        // Update version status to failed
        await updateOne('video_session_versions', { id: newVersion.id }, {
          status: 'failed',
        })
        
        // Refund coins on failure
        await deductUserCoins(user.id, coinsUsed).catch(() => null)
        
        return NextResponse.json(
          { error: `Failed to start video generation: ${genError.message}` },
          { status: 502 }
        )
      }

      // Update version with job_id
      await updateOne('video_session_versions', { id: newVersion.id }, {
        job_id: jobId,
      })

      // Update session
      const updatedSession = await updateOne(
        'video_sessions',
        { id: sessionId },
        {
          current_prompt: prompt || session.current_prompt,
          current_version: newVersionNumber,
          coins_used: session.coins_used + coinsUsed,
          updated_at: new Date(),
        }
      )

      // Delete old temp files beyond max versions (keep last 5)
      const versions = await find('video_session_versions', { session_id: sessionId })
      if (versions.length > 5) {
        const oldVersions = versions.slice(0, versions.length - 5)
        for (const oldVersion of oldVersions) {
          if (oldVersion.draft_video_path) {
            const filename = oldVersion.draft_video_path.split('/').pop()
            if (filename) await deleteTempVideo(filename)
          }
          await deleteOne('video_session_versions', { id: oldVersion.id })
        }
      }

      return NextResponse.json({ session: updatedSession, coins: remainingCoins, jobId })
    }

    if (action === 'switch_version') {
      if (!version_number) {
        return NextResponse.json({ error: 'Version number is required' }, { status: 400 })
      }

      const targetVersion = await findOne('video_session_versions', {
        session_id: sessionId,
        version_number,
      })

      if (!targetVersion) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      }

      const updatedSession = await updateOne(
        'video_sessions',
        { id: sessionId },
        {
          current_prompt: targetVersion.prompt,
          current_version: version_number,
          draft_video_path: targetVersion.draft_video_path,
          updated_at: new Date(),
        }
      )

      return NextResponse.json({ session: updatedSession })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('[video-sessions] PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/video-sessions/[sessionId]
 * Cancel session (delete temp files and mark as cancelled)
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sessionId } = await params
    const session = await findOne('video_sessions', { id: sessionId, user_id: user.id })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Delete temp files
    await deleteSessionTempVideos(sessionId)

    // Mark session as cancelled
    await updateOne('video_sessions', { id: sessionId }, {
      status: 'cancelled',
      updated_at: new Date(),
    })

    // Note: Coins are NOT refunded as per requirements

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[video-sessions] DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
