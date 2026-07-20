import { NextRequest, NextResponse } from 'next/server'
import { findOne, insert, updateOne } from '@/lib/supabase'
import {
  normalizePlatform,
  SUPPORTED_PLATFORMS,
  getBaseUrl,
  getRedirectUri,
  getOAuthCredentials,
  verifyOAuthSession,
} from '@/lib/social-connect'

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type PlatformHandlerResult = {
  accountId: string
  accountUsername: string
  accessToken: string
  refreshToken?: string | null
  tokenExpiry?: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const paramsData = await params
  let platform: string
  try {
    platform = normalizePlatform(paramsData.platform)
  } catch {
    return redirectError(getBaseUrl(req.nextUrl.origin), `Platform ${paramsData.platform} not supported`)
  }

  if (!SUPPORTED_PLATFORMS.includes(platform as any)) {
    return redirectError(getBaseUrl(req.nextUrl.origin), `Callback for platform ${platform} is not supported.`)
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')
  const errorDescription = req.nextUrl.searchParams.get('error_description')

  const baseUrl = getBaseUrl(req.nextUrl.origin)
  const sendError = (message: string) => redirectError(baseUrl, message)

  if (errorParam) {
    return redirectError(baseUrl, errorDescription || errorParam)
  }
  if (!code || !state) {
    return sendError('Missing code or state in OAuth callback.')
  }

  const session = await verifyOAuthSession(state)
  if (!session) {
    return sendError('Invalid or expired OAuth state. Please try connecting again.')
  }
  if (session.platform !== platform) {
    return sendError('Platform mismatch in OAuth callback.')
  }

  const redirectUri = getRedirectUri(platform, baseUrl)
  if (!redirectUri) {
    return sendError(`${platform} redirect URI is not configured.`)
  }

  const now = new Date().toISOString()
  let result: PlatformHandlerResult

  try {
    switch (platform) {
      case 'youtube':
        result = await handleYouTube(code, redirectUri)
        break
      case 'facebook':
        result = await handleFacebook(code, redirectUri)
        break
      case 'instagram':
        result = await handleInstagram(code, redirectUri, baseUrl)
        break
      case 'tiktok':
        result = await handleTikTok(code, redirectUri)
        break
      case 'twitter':
        result = await handleTwitter(code, redirectUri, session.codeVerifier)
        break
      case 'threads':
        result = await handleThreads(code, redirectUri)
        break
      default:
        return sendError(`Callback handler for ${platform} not yet implemented.`)
    }
  } catch (e: any) {
    return sendError(e.message || 'OAuth callback failed.')
  }

  const existing = await findOne('social_connects', { user_id: session.userId, platform })
  const connectionData: any = {
    user_id: session.userId,
    platform,
    account_username: result.accountUsername,
    account_id: result.accountId,
    access_token: result.accessToken,
    refresh_token: result.refreshToken || null,
    token_expiry: result.tokenExpiry || null,
    status: 'active',
    updated_at: now,
  }

  if (!existing) {
    connectionData.created_at = now
    await insert('social_connects', connectionData)
  } else {
    await updateOne('social_connects', { user_id: session.userId, platform }, connectionData)
  }

  return NextResponse.redirect(`${baseUrl}/dashboard/auto-upload`)
}

function redirectError(baseUrl: string, message: string) {
  console.error('[social-connect/callback] Error:', message)
  return NextResponse.redirect(`${baseUrl}/dashboard/auto-upload?error=${encodeURIComponent(message)}`)
}

async function exchangeToken(url: string, body: URLSearchParams): Promise<TokenResponse> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await resp.json()
  if (!resp.ok || data.error) {
    throw new Error(data.error_description || data.error?.message || data.error || `Token exchange failed: ${resp.status}`)
  }
  return data
}

async function handleYouTube(code: string, redirectUri: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('youtube')
  if (!creds) throw new Error('Google OAuth credentials are not configured.')

  const data = await exchangeToken('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }))

  const userResp = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const userData = await userResp.json()
  if (!userResp.ok) throw new Error(userData.error?.message || 'Failed to retrieve YouTube channel info.')

  const channel = userData.items?.[0]
  if (!channel) throw new Error('No YouTube channel found for this account. Ensure the Google account has a YouTube channel.')

  return {
    accountId: channel.id,
    accountUsername: channel.snippet?.title || channel.id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}

async function handleFacebook(code: string, redirectUri: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('facebook')
  if (!creds) throw new Error('Facebook OAuth credentials are not configured.')

  const data = await exchangeToken('https://graph.facebook.com/v18.0/oauth/access_token', new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }))

  const userResp = await fetch(
    `https://graph.facebook.com/v18.0/me?fields=id,name,picture&access_token=${data.access_token}`,
  )
  const userData = await userResp.json()
  if (!userResp.ok) throw new Error(userData.error?.message || 'Failed to retrieve Facebook user info.')

  const pagesResp = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${data.access_token}`,
  )
  const pagesData = await pagesResp.json()
  if (pagesResp.ok && Array.isArray(pagesData.data) && pagesData.data.length > 0) {
    const page = pagesData.data[0]
    return {
      accountId: page.id,
      accountUsername: page.name || userData.name || page.id,
      accessToken: page.access_token || data.access_token,
      tokenExpiry: null,
    }
  }

  return {
    accountId: userData.id,
    accountUsername: userData.name || userData.id,
    accessToken: data.access_token,
    tokenExpiry: null,
  }
}

async function handleInstagram(code: string, redirectUri: string, baseUrl: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('facebook')
  if (!creds) {
    throw new Error(
      'Instagram requires Facebook App credentials. Please set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env.',
    )
  }

  const data = await exchangeToken('https://graph.facebook.com/v18.0/oauth/access_token', new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }))

  const pagesResp = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${data.access_token}`,
  )
  const pagesData = await pagesResp.json()
  if (!pagesResp.ok) throw new Error(pagesData.error?.message || 'Failed to retrieve Facebook pages.')

  const page = Array.isArray(pagesData.data)
    ? pagesData.data.find((p: any) => p.instagram_business_account?.id)
    : null

  if (!page) {
    throw new Error(
      'No Instagram Business account found. Ensure your Instagram account is connected to a Facebook Page where you are an Admin.',
    )
  }

  const igId = page.instagram_business_account.id
  const pageToken = page.access_token || data.access_token

  const igResp = await fetch(
    `https://graph.facebook.com/v18.0/${igId}?fields=id,username,name&access_token=${pageToken}`,
  )
  const igData = await igResp.json()
  if (!igResp.ok) throw new Error(igData.error?.message || 'Failed to retrieve Instagram account info.')

  return {
    accountId: igData.id,
    accountUsername: igData.username || igData.name || igData.id,
    accessToken: pageToken,
    tokenExpiry: null,
  }
}

async function handleTikTok(code: string, redirectUri: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('tiktok')
  if (!creds) throw new Error('TikTok OAuth credentials are not configured.')

  const resp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  const raw = await resp.json()
  if (!resp.ok || raw.error) {
    throw new Error(raw.error_description || raw.error?.message || raw.error || `TikTok token exchange failed: ${resp.status}`)
  }

  const tokens = raw.data || raw
  return {
    accountId: tokens.open_id || raw.open_id || '',
    accountUsername: tokens.open_id || raw.open_id || '',
    accessToken: tokens.access_token || raw.access_token,
    refreshToken: tokens.refresh_token || raw.refresh_token,
    tokenExpiry: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : raw.expires_in
        ? new Date(Date.now() + raw.expires_in * 1000).toISOString()
        : null,
  }
}

async function handleTwitter(code: string, redirectUri: string, codeVerifier?: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('twitter')
  if (!creds) throw new Error('Twitter OAuth credentials are not configured.')
  if (!codeVerifier) throw new Error('Missing PKCE code verifier. Please reconnect your Twitter account.')

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')

  const resp = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  const data = await resp.json()
  if (!resp.ok || data.error) {
    throw new Error(data.error_description || data.error || `Twitter token exchange failed: ${resp.status}`)
  }

  const userResp = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const userData = await userResp.json()
  if (!userResp.ok) throw new Error(userData.error?.message || 'Failed to retrieve Twitter user info.')

  return {
    accountId: userData.data?.id || '',
    accountUsername: userData.data?.username || userData.data?.name || userData.data?.id || '',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}

async function handleThreads(code: string, redirectUri: string): Promise<PlatformHandlerResult> {
  const creds = getOAuthCredentials('threads')
  if (!creds) throw new Error('Threads OAuth credentials are not configured.')

  const data = await exchangeToken('https://graph.threads.net/oauth/access_token', new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }))

  const userResp = await fetch('https://graph.threads.net/v1.0/me?fields=id,username,name', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const userData = await userResp.json()
  if (!userResp.ok) throw new Error(userData.error?.message || 'Failed to retrieve Threads user info.')

  return {
    accountId: userData.id,
    accountUsername: userData.username || userData.name || userData.id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}
