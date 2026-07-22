import { NextRequest, NextResponse } from 'next/server'
import { readTempVideo } from '@/lib/temp-storage'

/**
 * GET /api/temp-video/[filename]
 * Serve temporary video files for preview during editing sessions
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params
    const buffer = await readTempVideo(filename)
    
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('[temp-video] Failed to serve file:', error)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
