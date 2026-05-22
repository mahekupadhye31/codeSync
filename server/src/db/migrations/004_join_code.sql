-- Phase 4: short, friendly join codes for rooms (shared instead of raw UUIDs)

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS join_code VARCHAR(8);

-- Backfill existing rooms with a unique 6-char code from an unambiguous alphabet
-- (no 0/O/1/I/L) so codes are easy to read and type.
DO $$
DECLARE
  r        RECORD;
  code     TEXT;
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  FOR r IN SELECT id FROM rooms WHERE join_code IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM rooms WHERE join_code = code);
    END LOOP;
    UPDATE rooms SET join_code = code WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_join_code
  ON rooms (join_code)
  WHERE join_code IS NOT NULL;
