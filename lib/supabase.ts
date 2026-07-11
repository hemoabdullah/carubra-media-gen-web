import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseClient) {
    const supabaseUrl = getSupabaseUrl()
    const supabaseKey = getSupabaseAnonKey()
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    supabaseClient = createClient(supabaseUrl, supabaseKey)
  }
  return supabaseClient
}

export async function getSupabaseAdmin(): Promise<SupabaseClient> {
  const supabaseUrl = getSupabaseUrl()
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
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
  console.log(`[supabase] findOne query: table=${table}, filter=${JSON.stringify(filter)}`)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error(`[supabase] findOne error: table=${table}, error=${JSON.stringify(error)}`)
    throw error
  }
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
  console.log(`[supabase] find query: table=${table}, filter=${JSON.stringify(filter)}, options=${JSON.stringify(options)}`)
  const { data, error } = await query
  if (error) {
    console.error(`[supabase] find error: table=${table}, error=${JSON.stringify(error)}`)
    throw error
  }
  return data ?? []
}

export async function updateOne(table: string, filter: Record<string, any>, data: any): Promise<any> {
  const supabase = await getSupabaseAdmin()
  let query = supabase.from(table).update(data)
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  console.log(`[supabase] updateOne query: table=${table}, filter=${JSON.stringify(filter)}, data keys=${Object.keys(data)}`)
  const { data: result, error } = await query.select().single()
  if (error) {
    console.error(`[supabase] updateOne error: table=${table}, error=${JSON.stringify(error)}`)
    throw error
  }
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
