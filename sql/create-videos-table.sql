-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create videos table for video AI generation
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  prompt TEXT NOT NULL,
  model TEXT DEFAULT 'text-to-video' CHECK (model IN ('text-to-video', 'image-to-video')),
  source_image_url TEXT,
  resolution TEXT DEFAULT '480p' CHECK (resolution IN ('480p', '720p')),
  aspect_ratio TEXT DEFAULT '16:9' CHECK (aspect_ratio IN ('2:3', '3:2', '1:1', '16:9', '9:16')),
  duration INTEGER DEFAULT 30 CHECK (duration BETWEEN 1 AND 60),
  coins_used INTEGER DEFAULT 2,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  job_id TEXT,
  video_url TEXT,
  caption TEXT,
  generation_time_seconds INTEGER,
  video_width INTEGER,
  video_height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON public.videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_user_created ON public.videos(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status ON public.videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_job_id ON public.videos(job_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS trigger_videos_updated_at ON public.videos;

CREATE TRIGGER trigger_videos_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
