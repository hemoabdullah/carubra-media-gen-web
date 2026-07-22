import * as fs from 'fs';
import * as path from 'path';
import { mkdir } from 'fs/promises';

// Temporary storage directory for draft videos
const TEMP_DIR = path.join(process.cwd(), 'temp', 'videos');

/**
 * Ensure temp directory exists
 */
export async function ensureTempDir(): Promise<void> {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
    if ((error as any).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Save video buffer to temporary storage
 * @param filename - Unique filename for the video
 * @param buffer - Video data buffer
 * @returns The filename (relative to temp dir) for use in URLs
 */
export async function saveTempVideo(filename: string, buffer: Buffer): Promise<string> {
  await ensureTempDir();
  const filePath = path.join(TEMP_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filename;
}

/**
 * Read video from temporary storage
 * @param filename - Filename to read
 * @returns Video buffer
 */
export async function readTempVideo(filename: string): Promise<Buffer> {
  const filePath = path.join(TEMP_DIR, filename);
  const buffer = await fs.promises.readFile(filePath);
  return buffer;
}

/**
 * Delete video from temporary storage
 * @param filename - Filename to delete
 */
export async function deleteTempVideo(filename: string): Promise<void> {
  const filePath = path.join(TEMP_DIR, filename);
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    // File might not exist, ignore
    if ((error as any).code !== 'ENOENT') {
      console.error(`[temp-storage] Failed to delete temp file ${filename}:`, error);
    }
  }
}

/**
 * Delete all temporary videos for a session
 * @param sessionPrefix - Session ID prefix to match
 */
export async function deleteSessionTempVideos(sessionPrefix: string): Promise<void> {
  await ensureTempDir();
  try {
    const files = await fs.promises.readdir(TEMP_DIR);
    for (const file of files) {
      if (file.startsWith(sessionPrefix)) {
        await deleteTempVideo(file);
      }
    }
  } catch (error) {
    console.error(`[temp-storage] Failed to delete session temp files for ${sessionPrefix}:`, error);
  }
}

/**
 * Clean up expired temporary files (older than 2 hours)
 */
export async function cleanupExpiredTempFiles(): Promise<void> {
  await ensureTempDir();
  try {
    const files = await fs.promises.readdir(TEMP_DIR);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
          console.log(`[temp-storage] Cleaned up expired temp file: ${file}`);
        }
      } catch (error) {
        console.error(`[temp-storage] Failed to clean up ${file}:`, error);
      }
    }
  } catch (error) {
    console.error('[temp-storage] Cleanup failed:', error);
  }
}

/**
 * Generate unique filename for a session version
 * @param sessionId - Session ID
 * @param versionNumber - Version number
 * @returns Unique filename
 */
export function generateTempFilename(sessionId: string, versionNumber: number): string {
  return `${sessionId}_v${versionNumber}_${Date.now()}.mp4`;
}
