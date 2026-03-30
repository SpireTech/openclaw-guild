-- ============================================================
-- User auto-capture preference
-- ============================================================
-- Allows users to opt out of automated fact extraction from
-- their conversations. When false, the agent_end hook skips
-- auto-capture for this user. Does not affect explicit
-- guild_user_save tool calls.

ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_capture_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN users.auto_capture_enabled IS
  'When false, the agent_end auto-capture hook skips fact extraction for this user. '
  'Does not affect explicit guild_user_save calls during conversation.';
