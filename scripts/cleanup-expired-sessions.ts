import { find, updateOne, deleteOne } from '@/lib/supabase'
import { deleteSessionTempVideos, cleanupExpiredTempFiles } from '@/lib/temp-storage'

/**
 * Cleanup expired video sessions and temporary files
 * This script should be run periodically (e.g., via cron job)
 */
export async function cleanupExpiredSessions() {
  console.log('[cleanup] Starting expired sessions cleanup...')

  try {
    // Find expired sessions
    const now = new Date()
    const expiredSessions = await find('video_sessions', {
      status: 'editing',
    })

    let cleanedCount = 0
    for (const session of expiredSessions) {
      const expiresAt = new Date(session.expires_at)
      if (expiresAt < now) {
        console.log(`[cleanup] Marking expired session ${session.id} as expired`)
        
        // Mark session as expired
        await updateOne('video_sessions', { id: session.id }, {
          status: 'expired',
          updated_at: new Date(),
        })

        // Delete temp files
        await deleteSessionTempVideos(session.id)
        cleanedCount++
      }
    }

    console.log(`[cleanup] Cleaned up ${cleanedCount} expired sessions`)
  } catch (error) {
    console.error('[cleanup] Error cleaning up expired sessions:', error)
  }

  // Clean up expired temp files
  console.log('[cleanup] Cleaning up expired temp files...')
  await cleanupExpiredTempFiles()
  console.log('[cleanup] Cleanup complete')
}

// Run if executed directly
if (require.main === module) {
  cleanupExpiredSessions()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
