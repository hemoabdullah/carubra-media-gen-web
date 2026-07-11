-- SQL to create basic tables used by the app. Run this in Supabase SQL editor.
-- If you see "table not found in schema cache", re-run this script in your Supabase SQL editor
-- and refresh the table metadata in the Supabase dashboard after deployment.

-- Users table (if not present)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  name text,
  phone text,
  role text DEFAULT 'User',
  coins integer DEFAULT 0,
  password text,
  password_changes_used integer DEFAULT 0,
  membership_order text,
  is_banned boolean DEFAULT false,
  total_created_videos integer DEFAULT 0,
  connected_social_accounts integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Example admin account: insert a user with role='Admin' and a bcrypt-hashed password.
-- Run this in Supabase SQL editor after creating the users table.
INSERT INTO public.users (email, name, role, password) VALUES ('adminkece@carubra.com', 'Admin Kece', 'Admin', '$2a$10$hbqC4rjLOT1YM1fvgOsAB.uHitJRNMQEC4iRh1Z4848uNV1osFT32');

-- Social connects
CREATE TABLE IF NOT EXISTS public.social_connects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'x', 'threads', 'whatsapp')),
  account_username text,
  account_id text,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- OAuth sessions for social media authentication flow
CREATE TABLE IF NOT EXISTS public.oauth_sessions (
  state text PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  code_verifier text,
  created_at timestamptz DEFAULT now(),
  expired_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_sessions_user_id ON public.oauth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expired_at ON public.oauth_sessions (expired_at);

-- Scheduled posts
CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  platform text,
  content text,
  scheduled_at timestamptz,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Generated contents
CREATE TABLE IF NOT EXISTS public.generated_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  title text,
  content text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Helpful index for queries by user
CREATE INDEX IF NOT EXISTS idx_generated_contents_user_id ON public.generated_contents (user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON public.scheduled_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_social_connects_user_id ON public.social_connects (user_id);

CREATE TABLE IF NOT EXISTS public.membership_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coins integer NOT NULL,
  price text NOT NULL,
  description text,
  tag text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  package_id uuid REFERENCES public.membership_packages(id),
  coins_purchased integer DEFAULT 0,
  amount integer DEFAULT 0,
  payment_method text,
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
  xendit_invoice_id text,
  xendit_payment_url text,
  invoice_number text,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_package_id ON public.transactions (package_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions (payment_status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_email text,
  action text,
  description text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text,
  error_message text,
  status_code integer,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_email text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_email text,
  api_name text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  quota_remaining integer,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON public.user_activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON public.user_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_error_logs_endpoint ON public.api_error_logs (endpoint);
CREATE INDEX IF NOT EXISTS idx_api_error_logs_created_at ON public.api_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_api_name ON public.ai_usage_logs (api_name);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON public.ai_usage_logs (created_at DESC);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false;
-- Kolom avatar untuk foto profil user (URL Supabase Storage)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar text;

-- Grant minimal privileges to anon (optional) - adjust for your environment
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_contents TO anon;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO anon;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_connects TO anon;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon;

-- ─────────────────────────────────────────────────────────────────
-- SUPABASE STORAGE: Bucket "avatars" untuk foto profil user
-- Jalankan ini di Supabase SQL Editor ATAU buat bucket manual di
-- Storage → New bucket → Name: avatars → Public: ON
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: user bisa upload avatar mereka sendiri
CREATE POLICY IF NOT EXISTS "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Policy: avatar bisa dibaca siapa saja (public)
CREATE POLICY IF NOT EXISTS "Avatars are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Policy: user bisa update avatar mereka sendiri
CREATE POLICY IF NOT EXISTS "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ─────────────────────────────────────────────────────────────────
-- SUPABASE STORAGE: Bucket "generated-videos" untuk video AI
-- Jalankan ini di Supabase SQL Editor ATAU buat bucket manual di
-- Storage → New bucket → Name: generated-videos → Public: ON
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-videos', 'generated-videos', true)
ON CONFLICT (id) DO NOTHING;

-- If bucket already exists and is private, make it public
UPDATE storage.buckets SET public = true WHERE id = 'generated-videos' AND public = false;

-- Policy: user dapat upload video mereka sendiri
CREATE POLICY IF NOT EXISTS "Users can upload own video"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'generated-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Policy: video dapat dibaca siapa saja (public)
CREATE POLICY IF NOT EXISTS "Generated videos are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'generated-videos');

-- Policy: user dapat menghapus video mereka sendiri
CREATE POLICY IF NOT EXISTS "Users can delete own video"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'generated-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
