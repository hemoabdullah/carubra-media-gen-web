import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    supabase_url: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
    next_public_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'NOT SET',
    supabase_anon_key: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
    next_public_supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
    supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET',
    vercel_env: process.env.VERCEL_ENV || 'NOT SET',
    node_env: process.env.NODE_ENV || 'NOT SET',
  })
}
