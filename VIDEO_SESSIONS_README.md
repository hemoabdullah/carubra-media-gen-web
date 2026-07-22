# Video Generation Editing Session System

This document describes the new Video Generation Consistency/Editing Session system implemented for the Carubra Media Generator.

## Overview

The editing session system allows users to iteratively refine AI-generated videos before permanently saving them to Supabase Storage and the database. This prevents storage bloat, keeps history clean, and provides a better user experience similar to Midjourney, Runway, or Pika.

## Key Features

- **Temporary Draft Storage**: Videos are stored locally in `/temp/videos` during editing
- **Version History**: Users can switch between up to 5 versions within a session
- **Coin System**: 2 coins deducted per generation/edit/regenerate (no refunds on cancel)
- **Session Recovery**: Active sessions are restored on page refresh
- **Auto Cleanup**: Expired sessions (2 hours) and temp files are automatically cleaned up
- **Transactional Saves**: Upload and database operations are atomic to prevent inconsistent states
- **Clean History**: Only completed videos appear in history, never drafts

## Database Schema

### video_sessions Table

Stores the editing session state:

```sql
CREATE TABLE public.video_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  original_prompt TEXT NOT NULL,
  current_prompt TEXT NOT NULL,
  draft_video_path TEXT,
  current_version INTEGER DEFAULT 1,
  coins_used INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('editing', 'completed', 'cancelled', 'expired')),
  resolution TEXT CHECK (resolution IN ('480p', '720p')),
  aspect_ratio TEXT CHECK (aspect_ratio IN ('2:3', '3:2', '1:1', '16:9', '9:16')),
  duration INTEGER CHECK (duration BETWEEN 1 AND 60),
  model TEXT CHECK (model IN ('text-to-video', 'image-to-video')),
  source_image_url TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours'
);
```

### video_session_versions Table

Stores version history within a session:

```sql
CREATE TABLE public.video_session_versions (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES video_sessions(id),
  version_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  draft_video_path TEXT,
  video_url TEXT,
  job_id TEXT,
  status TEXT CHECK (status IN ('draft', 'completed', 'failed')),
  created_at TIMESTAMPTZ,
  UNIQUE(session_id, version_number)
);
```

## Setup Instructions

### 1. Run Database Migration (Optional but Recommended)

**Important**: The app will work normally without the migration. The session features will be disabled until you run the migration.

Execute the SQL file in Supabase SQL Editor:

```bash
# Run this in Supabase SQL Editor
sql/create-video-sessions-table.sql
```

**Before migration**: The app will use the legacy video generation flow (direct save to database).
**After migration**: The app will use the new session-based editing flow with version history.

### 2. Ensure Storage Bucket Exists

Make sure you have a `generated-videos` bucket in Supabase Storage for final video uploads.

### 3. Set Up Temp Directory

The system uses `/temp/videos` for temporary draft storage. This is automatically created by the application.

### 4. Configure Cleanup Job

Set up a cron job or scheduled task to run the cleanup script periodically (recommended: every hour):

```bash
# Using npx
npx tsx scripts/cleanup-expired-sessions.ts

# Or add to package.json scripts:
"cleanup:sessions": "tsx scripts/cleanup-expired-sessions.ts"
```

## API Endpoints

### Session Management

- `POST /api/video-sessions` - Create new editing session
- `GET /api/video-sessions` - Get all active sessions for user
- `GET /api/video-sessions/[sessionId]` - Get session with versions
- `PATCH /api/video-sessions/[sessionId]` - Update session (edit, regenerate, switch version)
- `DELETE /api/video-sessions/[sessionId]` - Cancel session (no refund)
- `POST /api/video-sessions/[sessionId]/complete` - Save final video to Supabase

### Temporary Video Serving

- `GET /api/temp-video/[filename]` - Serve temp video for preview

## Workflow

### User Flow

1. **Generate Initial Draft**
   - User enters prompt and clicks "Generate"
   - Creates session, deducts 2 coins
   - Video generated and stored in `/temp/videos`

2. **Edit/Refine**
   - User enters new prompt (e.g., "make him smile")
   - Clicks "Generate Edit" - deducts 2 coins
   - New version created, old version preserved
   - User can switch between versions

3. **Regenerate**
   - User clicks "Regenerate" with same prompt
   - New version created - deducts 2 coins

4. **Complete**
   - User satisfied with current version
   - Clicks "Save Final Video"
   - Video uploaded to Supabase Storage
   - Record inserted into `videos` table
   - Session marked as completed
   - Temp files deleted

5. **Cancel**
   - User clicks "Cancel"
   - Session marked as cancelled
   - Temp files deleted
   - Coins NOT refunded

### Session Recovery

- On page load, check for active sessions
- If found, restore session editor automatically
- User can continue editing where they left off

## Safety Features

### Button State Management

- All buttons disabled during operations
- Loading states shown for clarity
- Prevents double-clicks and race conditions

### Transactional Saves

```typescript
// Upload to Supabase
finalVideoUrl = await uploadToStorage(...)

// Insert to database
await insert('videos', videoRecord)

// If database fails, rollback upload
catch (dbError) {
  await storage.remove([storagePath])
}
```

### Auto Cleanup

- Sessions expire after 2 hours
- Temp files older than 2 hours deleted
- Cleanup script runs periodically
- No orphaned files or sessions

## Coin Logic

- **Initial Generation**: 2 coins (based on resolution)
- **Edit**: 2 coins per edit
- **Regenerate**: 2 coins per regenerate
- **Cancel**: No refund
- **Total**: Accumulated in session, shown on completion

## UI Components

### VideoSessionEditor

Main editing component with:
- Video preview
- Version switcher
- Edit prompt input
- Generate Edit / Regenerate buttons
- Save Final Video / Cancel buttons
- Coin cost display
- Version history

### Integration

The editor is integrated into the video-ai page:
- Replaces standard generation flow
- Shows when active session exists
- Back button to return to main view

## Troubleshooting

### Temp Files Not Creating

Check permissions on `/temp/videos` directory:
```bash
mkdir -p temp/videos
chmod 755 temp/videos
```

### Sessions Not Recovering

Check browser console for API errors. Ensure `/api/video-sessions` is returning active sessions.

### Cleanup Not Running

Verify the cleanup script is executable and scheduled:
```bash
chmod +x scripts/cleanup-expired-sessions.ts
```

## Future Enhancements

- [ ] Add thumbnail generation for completed videos
- [ ] Support for image-to-video editing sessions
- [ ] Export session as project file
- [ ] Collaborative editing sessions
- [ ] Advanced video editing tools (trim, merge, effects)
