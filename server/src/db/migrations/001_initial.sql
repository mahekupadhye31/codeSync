-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (populated via GitHub OAuth)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id   VARCHAR(64) UNIQUE NOT NULL,
  username    VARCHAR(255) NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  language    VARCHAR(50)  NOT NULL DEFAULT 'javascript',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms(created_by);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at DESC);

-- Tracks the live content + OT revision counter for each room
CREATE TABLE IF NOT EXISTS room_state (
  room_id    UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL DEFAULT '',
  revision   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Room membership log
CREATE TABLE IF NOT EXISTS room_members (
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- Code snapshots (auto-snapshotted every 5 min by background job)
CREATE TABLE IF NOT EXISTS snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_room_created ON snapshots(room_id, created_at DESC);
