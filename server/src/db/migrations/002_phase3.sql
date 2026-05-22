-- Phase 3 additions: snapshot labels, shareable room tokens

ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS label VARCHAR(255);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS share_token VARCHAR(512);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_share_token
  ON rooms (share_token)
  WHERE share_token IS NOT NULL;
