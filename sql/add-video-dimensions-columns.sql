-- Add video_width and video_height columns to videos table
-- Run this in Supabase SQL editor

ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS video_width INTEGER,
ADD COLUMN IF NOT EXISTS video_height INTEGER;