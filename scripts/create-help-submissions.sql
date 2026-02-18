-- Create help_submissions table to persist feedback/bug reports
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS help_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  user_email text,
  issue_type text NOT NULL DEFAULT 'other',
  message text NOT NULL,
  page_url text,
  created_at timestamptz DEFAULT now()
);

-- RLS: users can insert their own, admin can view all
ALTER TABLE help_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own submissions"
  ON help_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own submissions"
  ON help_submissions FOR SELECT
  USING (auth.uid() = user_id);

-- Index for admin dashboard queries
CREATE INDEX idx_help_submissions_created ON help_submissions(created_at DESC);
