-- ============================================
-- Shortify AI - P1 Migration: usage_logs table + credits update
-- ============================================

-- Create usage_logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  credits_used INTEGER NOT NULL,
  drama_id TEXT REFERENCES dramas(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS usage_logs_user_id_idx ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS usage_logs_drama_id_idx ON usage_logs(drama_id);

-- Update existing users to 200 credits (from the previous default of 10)
UPDATE users SET credits = 200 WHERE credits = 10;
