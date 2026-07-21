import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Removed module-level caching to avoid stale environment variables in serverless environments

function getSupabaseUrl(): string {
  // On server (Vercel/Node), use SUPABASE_URL
  // On client/browser, use NEXT_PUBLIC_SUPABASE_URL
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    console.error('[supabase] Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')
    console.error('[supabase] Available env vars:', {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    })
  }
  return url || ''
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) {
    console.error('[supabase] Missing SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return key || ''
}

export async function getSupabase(): Promise<SupabaseClient> {
  // Don't cache the anon client to avoid stale environment variables
  // In serverless environments, module-level caching can cause issues
  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = getSupabaseAnonKey()
  if (!supabaseUrl) {
    throw new Error('Missing environment variable: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!supabaseKey) {
    throw new Error('Missing environment variable: SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function getSupabaseAdmin(): Promise<SupabaseClient> {
  const supabaseUrl = getSupabaseUrl()
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseUrl) {
    throw new Error('Missing environment variable: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!supabaseServiceKey) {
    throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

export async function insert(table: string, data: any): Promise<any> {
  const supabase = await getSupabaseAdmin()
  const { data: result, error } = await supabase.from(table).insert([data]).select().single()
  if (error) throw error
  return result
}

export async function findOne(table: string, filter: Record<string, any>): Promise<any> {
  const supabase = await getSupabaseAdmin()
  let query = supabase.from(table).select('*')
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function find(
  table: string,
  filter: Record<string, any> = {},
  options: { orderBy?: string; ascending?: boolean; limit?: number } = {}
): Promise<any[]> {
  const supabase = await getSupabaseAdmin()
  let query = supabase.from(table).select('*')
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending ?? true })
  if (options.limit) query = query.limit(options.limit)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function updateOne(table: string, filter: Record<string, any>, data: any): Promise<any> {
  const supabase = await getSupabaseAdmin()
  let query = supabase.from(table).update(data)
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  const { data: result, error } = await query.select().single()
  if (error) throw error
  return result
}

export async function upsert(table: string, data: any, options?: { onConflict?: string }): Promise<any> {
  const supabase = await getSupabaseAdmin()
  const { data: result, error } = await supabase.from(table).upsert(data, options).select().single()
  if (error) throw error
  return result
}

export async function deleteOne(table: string, filter: Record<string, any>): Promise<boolean> {
  const supabase = await getSupabaseAdmin()
  let query = supabase.from(table).delete()
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  const { error } = await query
  if (error) throw error
  return true
}

export async function uploadToStorage(
  bucket: string,
  path: string,
  file: Buffer | Blob | File | Uint8Array,
  options?: { contentType?: string; cacheControl?: string }
): Promise<string> {
  const supabase = await getSupabaseAdmin()
  const storage = supabase.storage.from(bucket)
  const { data, error } = await storage.upload(path, file, {
    contentType: options?.contentType,
    cacheControl: options?.cacheControl,
    upsert: true,
  })
  if (error) throw error
  const { data: urlData } = storage.getPublicUrl(path)
  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL for uploaded file')
  }
  return urlData.publicUrl
}
