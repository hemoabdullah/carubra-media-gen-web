-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create video_sessions table for editing session management
-- Run this in Supabase SQL editor

-- If you already ran this migration and got an error about aspect_ratio or resolution,
-- run these commands to update the constraints:
-- ALTER TABLE public.video_sessions DROP CONSTRAINT video_sessions_aspect_ratio_check;
-- ALTER TABLE public.video_sessions ADD CONSTRAINT video_sessions_aspect_ratio_check CHECK (aspect_ratio IN ('2:3', '3:2', '1:1', '16:9', '9:16', '4:3', '3:4'));
-- ALTER TABLE public.video_sessions DROP CONSTRAINT video_sessions_resolution_check;
-- ALTER TABLE public.video_sessions ADD CONSTRAINT video_sessions_resolution_check CHECK (resolution IN ('480p', '720p', '1080p', '2K'));

CREATE TABLE IF NOT EXISTS public.video_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  original_prompt TEXT NOT NULL,
  current_prompt TEXT NOT NULL,
  draft_video_path TEXT, -- Local temporary file path
  current_version INTEGER DEFAULT 1,
  coins_used INTEGER DEFAULT 0,
  status TEXT DEFAULT 'editing' CHECK (status IN ('editing', 'completed', 'cancelled', 'expired')),
  resolution TEXT DEFAULT '480p' CHECK (resolution IN ('480p', '720p', '1080p', '2K')),
  aspect_ratio TEXT DEFAULT '16:9' CHECK (aspect_ratio IN ('2:3', '3:2', '1:1', '16:9', '9:16', '4:3', '3:4')),
  duration INTEGER DEFAULT 30 CHECK (duration BETWEEN 1 AND 60),
  model TEXT DEFAULT 'text-to-video' CHECK (model IN ('text-to-video', 'image-to-video')),
  source_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours'
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_video_sessions_user_id ON public.video_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_video_sessions_user_status ON public.video_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_video_sessions_expires_at ON public.video_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_video_sessions_created_at ON public.video_sessions(created_at DESC);

-- Create video_session_versions table for version history within sessions
CREATE TABLE IF NOT EXISTS public.video_session_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.video_sessions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  draft_video_path TEXT, -- Local temporary file path
  video_url TEXT, -- Final Supabase URL (only for completed versions)
  job_id TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, version_number)
);

-- Create indexes for version history
CREATE INDEX IF NOT EXISTS idx_video_session_versions_session_id ON public.video_session_versions(session_id);
CREATE INDEX IF NOT EXISTS idx_video_session_versions_version ON public.video_session_versions(session_id, version_number);

-- Create trigger for updated_at on video_sessions
CREATE OR REPLACE FUNCTION update_video_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS trigger_video_sessions_updated_at ON public.video_sessions;

CREATE TRIGGER trigger_video_sessions_updated_at
  BEFORE UPDATE ON public.video_sessions
  FOR EACH ROW EXECUTE FUNCTION update_video_sessions_updated_at();
