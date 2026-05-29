-- DEV-31: persist the ElevenLabs conversation_id on each interview session.
--
-- Why: the voice/delivery analysis feature (tone, pace, pauses, fillers) needs
-- the RAW AUDIO, which only ElevenLabs holds. The audio is fetched later via
-- GET /v1/convai/conversations/{id}/audio, keyed by conversation_id. Today the
-- evaluate endpoint only ever saw the text transcript and logged the
-- conversation_id to the browser console without storing it, so every recording
-- becomes unrecoverable the moment the session ends.
--
-- Additive + nullable: safe to apply ahead of the code deploy. Backfill is not
-- possible (past sessions never stored the id); those audios are already gone.

ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS elevenlabs_conversation_id TEXT;

COMMENT ON COLUMN interview_sessions.elevenlabs_conversation_id IS
  'ElevenLabs convai conversation_id; used to re-fetch raw audio for delivery analysis (DEV-31).';
