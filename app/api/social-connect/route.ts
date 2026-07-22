import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/middleware/auth'
import { find, insert } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const docs = await find('social_connects', { user_id: user.id })
    const connections = docs.map((doc: any) => ({
      platform: doc.platform,
      username: doc.account_username,
      connectedAt: doc.created_at,
    }))

    // TEMPORARY MOCK FOR DEMO
    // TODO: Replace with real Threads OAuth integration
    // Only mock Threads connection for user7@gmail.com
    if (user.email === 'user7@gmail.com') {
      const hasThreadsConnection = connections.some((c: any) => c.platform === 'threads')
      if (!hasThreadsConnection) {
        connections.push({
          platform: 'threads',
          username: 'user7@gmail.com',
          connectedAt: new Date().toISOString(),
        })
      }
    }

    return NextResponse.json({ connections })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { platform, username } = await req.json()

    const supportedPlatforms = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'threads', 'whatsapp']
    if (!platform || !username) {
      return NextResponse.json({ error: 'Platform and username are required' }, { status: 400 })
    }

    if (!supportedPlatforms.includes(platform)) {
      return NextResponse.json({ error: `Platform ${platform} is not supported.`, status: 400 })
    }

    if (platform === 'whatsapp') {
      const gowaClientId = process.env.GOWA_CLIENT_ID
      if (!gowaClientId) {
        return NextResponse.json({ error: 'GOWA_CLIENT_ID tidak dikonfigurasi. Hubungi developer.' }, { status: 500 })
      }
    }

    const doc = {
      user_id: user.id,
      platform,
      account_username: username,
      account_id: username,
      access_token: platform === 'whatsapp' ? process.env.GOWA_CLIENT_ID : 'manual',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await insert('social_connects', doc)
    return NextResponse.json({ message: 'Connected successfully' }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
