-- Phase A: multi-file projects. Each file is its own OT document; the tree is
-- derived from the `path` strings (e.g. 'src/main.py'). Folders may also exist
-- explicitly (is_dir = true) so empty folders persist.

CREATE TABLE IF NOT EXISTS files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  is_dir     BOOLEAN NOT NULL DEFAULT FALSE,
  content    TEXT NOT NULL DEFAULT '',
  revision   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, path)
);

CREATE INDEX IF NOT EXISTS idx_files_room ON files (room_id);

-- Backfill: every existing room gets one default file seeded from its current
-- single-document content, named by the room's language.
DO $$
DECLARE
  r     RECORD;
  fname TEXT;
BEGIN
  FOR r IN
    SELECT rm.id AS room_id, rm.language,
           COALESCE(rs.content, '') AS content,
           COALESCE(rs.revision, 0) AS revision
    FROM rooms rm
    LEFT JOIN room_state rs ON rs.room_id = rm.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM files WHERE room_id = r.room_id) THEN
      fname := CASE r.language
        WHEN 'python'     THEN 'main.py'
        WHEN 'javascript' THEN 'main.js'
        WHEN 'cpp'        THEN 'main.cpp'
        WHEN 'java'       THEN 'Main.java'
        WHEN 'go'         THEN 'main.go'
        ELSE 'main.txt'
      END;
      INSERT INTO files (room_id, path, is_dir, content, revision)
      VALUES (r.room_id, fname, FALSE, r.content, r.revision);
    END IF;
  END LOOP;
END $$;
