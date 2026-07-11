import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('SUPABASE_URL:', supabaseUrl ? 'SET' : 'NOT SET')
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'SET' : 'NOT SET')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifySchema() {
  console.log('=== VERIFYING DATABASE SCHEMA ===\n')

  // Check images table columns
  console.log('--- IMAGES TABLE COLUMNS ---')
  const { data: sampleImage } = await supabase
    .from('images')
    .select('*')
    .limit(1)
    .maybeSingle()
  
  if (sampleImage) {
    console.log('Sample image record keys:', Object.keys(sampleImage))
  } else {
    console.log('No sample image found, table may be empty')
  }

  // Check videos table columns
  console.log('\n--- VIDEOS TABLE COLUMNS ---')
  const { data: sampleVideo, error: videoError } = await supabase
    .from('videos')
    .select('*')
    .limit(1)
    .maybeSingle()
  
  if (videoError) {
    console.log('Error querying videos:', videoError.message)
  } else if (sampleVideo) {
    console.log('Sample video record keys:', Object.keys(sampleVideo))
  } else {
    console.log('No sample video found, table may be empty')
  }

  // Check recent images
  console.log('\n--- RECENT IMAGES (last 3) ---')
  const { data: recentImages } = await supabase
    .from('images')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)
  
  if (recentImages && recentImages.length > 0) {
    recentImages.forEach(img => {
      console.log(`ID: ${img.id}`)
      console.log(`  Status: ${img.status}`)
      console.log(`  Image URL: ${img.image_url ? img.image_url.substring(0, 80) + (img.image_url.length > 80 ? '...' : '') : 'NULL'}`)
      console.log(`  Storage Provider: ${(img as any).storage_provider || 'NULL'}`)
      console.log(`  Storage Bucket: ${(img as any).storage_bucket || 'NULL'}`)
      console.log(`  Storage Path: ${(img as any).storage_path || 'NULL'}`)
      console.log(`  Source URI: ${(img as any).source_uri ? (img as any).source_uri.substring(0, 80) + ((img as any).source_uri.length > 80 ? '...' : '') : 'NULL'}`)
      console.log(`  MIME Type: ${(img as any).mime_type || 'NULL'}`)
      console.log(`  Size: ${(img as any).size || 'NULL'}`)
      console.log(`  Created: ${img.created_at}`)
      console.log('')
    })
  } else {
    console.log('No recent images found')
  }

  // Check recent videos
  console.log('\n--- RECENT VIDEOS (last 3) ---')
  const { data: recentVideos } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)
  
  if (recentVideos && recentVideos.length > 0) {
    recentVideos.forEach(vid => {
      console.log(`ID: ${vid.id}`)
      console.log(`  Status: ${vid.status}`)
      console.log(`  Video URL: ${vid.video_url ? vid.video_url.substring(0, 80) + (vid.video_url.length > 80 ? '...' : '') : 'NULL'}`)
      console.log(`  Storage Provider: ${(vid as any).storage_provider || 'NULL'}`)
      console.log(`  Storage Bucket: ${(vid as any).storage_bucket || 'NULL'}`)
      console.log(`  Storage Path: ${(vid as any).storage_path || 'NULL'}`)
      console.log(`  Source URI: ${(vid as any).source_uri ? (vid as any).source_uri.substring(0, 80) + ((vid as any).source_uri.length > 80 ? '...' : '') : 'NULL'}`)
      console.log(`  MIME Type: ${(vid as any).mime_type || 'NULL'}`)
      console.log(`  Size: ${(vid as any).size || 'NULL'}`)
      console.log(`  Job ID: ${vid.job_id || 'NULL'}`)
      console.log(`  Created: ${vid.created_at}`)
      console.log('')
    })
  } else {
    console.log('No recent videos found')
  }

  // Check storage buckets
  console.log('\n--- SUPABASE STORAGE BUCKETS ---')
  const { data: buckets } = await supabase.storage.listBuckets()
  if (buckets) {
    buckets.forEach(bucket => {
      console.log(`Bucket: ${bucket.name}, Public: ${bucket.public}`)
    })
  }

  // Check generated-images bucket contents
  console.log('\n--- GENERATED-IMAGES BUCKET CONTENTS (recent 5) ---')
  const { data: imagesFiles, error: imagesError2 } = await supabase
    .storage.from('generated-images')
    .list('', { limit: 5, sortBy: { column: 'created_at', order: 'desc' } })
  
  if (imagesError2) {
    console.log(`Error: ${imagesError2.message}`)
  } else if (imagesFiles && imagesFiles.length > 0) {
    imagesFiles.forEach(file => {
      console.log(`  ${file.name} (${file.metadata?.size || 'unknown'} bytes)`)
    })
  } else {
    console.log('Bucket empty or does not exist')
  }

  // Check generated-videos bucket contents
  console.log('\n--- GENERATED-VIDEOS BUCKET CONTENTS (recent 5) ---')
  const { data: videosFiles, error: videosError2 } = await supabase
    .storage.from('generated-videos')
    .list('', { limit: 5, sortBy: { column: 'created_at', order: 'desc' } })
  
  if (videosError2) {
    console.log(`Error: ${videosError2.message}`)
  } else if (videosFiles && videosFiles.length > 0) {
    videosFiles.forEach(file => {
      console.log(`  ${file.name} (${file.metadata?.size || 'unknown'} bytes)`)
    })
  } else {
    console.log('Bucket empty or does not exist')
  }
}

verifySchema().catch(console.error)
