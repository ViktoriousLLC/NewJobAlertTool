-- Multi-session memory for the /interview-test page.
--
-- Two tables:
--   interview_sessions     — one row per session. Raw transcript + evaluations.
--                            Wiped 7 days after creation via daily cron.
--   interview_user_summary — one row per user (PK = user_id). Persistent rolling
--                            summary updated after every session. Survives the
--                            7-day session wipe.
--
-- Read path: on token mint, fetch interview_user_summary.summary and inject
-- into the agent's system prompt override.
-- Write path: after evaluate completes, INSERT new session row + regenerate
-- the user's summary by feeding existing summary + new transcript to an LLM.

CREATE TABLE IF NOT EXISTS interview_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interview_type  TEXT NOT NULL CHECK (interview_type IN ('behavioral', 'product_sense', 'analytics')),
  transcript      JSONB NOT NULL,
  duration_sec    INTEGER,
  evaluations     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_created
  ON interview_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_created_at
  ON interview_sessions(created_at);

ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own sessions"
  ON interview_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated role; writes via service-role only.


CREATE TABLE IF NOT EXISTS interview_user_summary (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  summary          TEXT NOT NULL DEFAULT '',
  session_count    INTEGER NOT NULL DEFAULT 0,
  last_session_id  UUID REFERENCES interview_sessions(id) ON DELETE SET NULL,
  last_session_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE interview_user_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own summary"
  ON interview_user_summary FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated role; writes via service-role only.
