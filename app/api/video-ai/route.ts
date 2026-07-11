import { NextRequest, NextResponse } from 'next/server'
import { find } from '@/lib/supabase'
import { getUserFromRequest } from '@/middleware/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const videos = await find('videos', { user_id: user.id }, { orderBy: 'created_at', ascending: false })

    console.log('[video-ai] History API - raw videos from DB:', videos.map(v => ({
      id: v.id,
      video_url: v.video_url,
      video_url_type: typeof v.video_url,
      status: v.status,
    })))

    console.log('[video-ai] History API - videos returned to frontend:', videos.map(v => ({
      id: v.id,
      video_url: v.video_url,
      video_url_type: typeof v.video_url,
    })))

    return NextResponse.json({ videos })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
