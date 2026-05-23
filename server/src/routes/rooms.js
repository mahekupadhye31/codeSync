import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { body, param, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { getRoomState, setRoomState } from '../redis/index.js';
import { broadcastToRoom, publishRoomEvent } from '../ws/handler.js';
import { snapshotTotal } from '../metrics.js';

const router = Router();

const VALID_LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'go'];

// Unambiguous alphabet (no 0/O/1/I/L) for human-friendly 6-char join codes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomJoinCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

async function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomJoinCode();
    const { rows } = await query('SELECT 1 FROM rooms WHERE join_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not generate a unique join code');
}

// Strip formatting (dashes/spaces/case) so "abc-123" and "ABC123" both resolve.
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Validation helper ────────────────────────────────────────────────────────
function validate(validations) {
  return [
    ...validations,
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }
      next();
    },
  ];
}

// ── Public route (must come before requireAuth middleware) ───────────────────

router.get('/shared/:token', async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
  } catch {
    return res.status(404).json({ message: 'Invalid or expired share link' });
  }

  const { rows } = await query(
    `SELECT r.id, r.name, r.language, rs.content
     FROM rooms r
     LEFT JOIN room_state rs ON rs.room_id = r.id
     WHERE r.id = $1 AND r.share_token = $2`,
    [payload.roomId, req.params.token]
  );

  if (!rows.length) return res.status(404).json({ message: 'Room not found or link revoked' });

  const live = await getRoomState(rows[0].id);
  const room = rows[0];
  if (live) room.content = live.content;

  res.json(room);
});

// ── All routes below require authentication ───────────────────────────────────
router.use(requireAuth);

// Create a new room
router.post(
  '/',
  validate([
    body('name')
      .trim()
      .notEmpty().withMessage('Room name is required')
      .isLength({ min: 1, max: 50 }).withMessage('Room name must be 1–50 characters')
      .not().matches(/<[^>]+>/).withMessage('Room name must not contain HTML'),
    body('language')
      .optional()
      .isIn(VALID_LANGUAGES).withMessage(`Language must be one of: ${VALID_LANGUAGES.join(', ')}`),
  ]),
  async (req, res) => {
    const { name, language = 'javascript' } = req.body;
    const joinCode = await generateUniqueJoinCode();

    const { rows } = await query(
      `INSERT INTO rooms (name, language, created_by, join_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, language, created_by, created_at, join_code`,
      [name.trim(), language, req.user.sub, joinCode]
    );

    const room = rows[0];
    await query(
      'INSERT INTO room_state (room_id, content, revision) VALUES ($1, $2, $3)',
      [room.id, '', 0]
    );
    // The creator is a member of their own room so it appears on their dashboard.
    await query(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, req.user.sub]
    );
    // Seed a default file so the room's tree isn't empty.
    const defaultFile = {
      python: 'main.py', javascript: 'main.js', cpp: 'main.cpp', java: 'Main.java', go: 'main.go',
    }[language] || 'main.txt';
    await query(
      'INSERT INTO files (room_id, path, is_dir, content, revision) VALUES ($1, $2, FALSE, $3, 0)',
      [room.id, defaultFile, '']
    );

    res.status(201).json(room);
  }
);

// List the current user's rooms (ones they've created or joined).
// Leaving a room removes its membership row, so it drops off this list;
// opening the room link re-adds membership via the WS join handler.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.name, r.language, r.created_at, r.created_by, r.join_code,
            u.username AS creator_username, u.avatar_url AS creator_avatar
     FROM rooms r
     JOIN room_members m ON m.room_id = r.id AND m.user_id = $1
     LEFT JOIN users u ON u.id = r.created_by
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [req.user.sub]
  );
  res.json(rows);
});

// Resolve a short join code to a room (used by "Join by code").
router.get('/code/:code', async (req, res) => {
  const code = normalizeCode(req.params.code);
  if (!code) return res.status(404).json({ message: 'Invalid code' });
  const { rows } = await query(
    'SELECT id, name, language, join_code FROM rooms WHERE join_code = $1',
    [code]
  );
  if (!rows.length) return res.status(404).json({ message: 'No room found for that code' });
  res.json(rows[0]);
});

// Get a single room with its current live content
router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.name, r.language, r.created_at, r.created_by, r.join_code,
            u.username AS creator_username, u.avatar_url AS creator_avatar,
            rs.content, rs.revision
     FROM rooms r
     LEFT JOIN users u ON u.id = r.created_by
     LEFT JOIN room_state rs ON rs.room_id = r.id
     WHERE r.id = $1`,
    [req.params.id]
  );

  if (!rows.length) return res.status(404).json({ message: 'Room not found' });

  const liveState = await getRoomState(req.params.id);
  const room = rows[0];
  if (liveState) {
    room.content  = liveState.content;
    room.revision = liveState.revision;
  }

  res.json(room);
});

// List the file tree for a room (id, path, is_dir)
router.get('/:id/files', async (req, res) => {
  const { rows } = await query(
    'SELECT id, path, is_dir FROM files WHERE room_id = $1 ORDER BY path',
    [req.params.id]
  );
  res.json(rows);
});

// List snapshots for a room (with preview and size)
router.get('/:id/snapshots', async (req, res) => {
  const { rows } = await query(
    `SELECT id, room_id, label, created_at,
            left(content, 120)   AS preview,
            length(content)      AS size_bytes
     FROM snapshots
     WHERE room_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

// Create a manual snapshot
router.post(
  '/:id/snapshots',
  validate([
    body('label')
      .optional()
      .trim()
      .isLength({ max: 100 }).withMessage('Snapshot label must be ≤ 100 characters')
      .not().matches(/<[^>]+>/).withMessage('Label must not contain HTML'),
  ]),
  async (req, res) => {
    const { label } = req.body;

    let state = await getRoomState(req.params.id);
    if (!state) {
      const { rows: sr } = await query(
        'SELECT content FROM room_state WHERE room_id = $1',
        [req.params.id]
      );
      if (!sr.length) return res.status(404).json({ message: 'Room not found' });
      state = sr[0];
    }

    const { rows } = await query(
      'INSERT INTO snapshots (room_id, content, label) VALUES ($1, $2, $3) RETURNING id, room_id, label, created_at',
      [req.params.id, state.content, label?.trim() || 'Manual save']
    );

    snapshotTotal.inc();
    res.status(201).json(rows[0]);
  }
);

// Get a specific snapshot's content
router.get('/:id/snapshots/:snapshotId', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM snapshots WHERE id = $1 AND room_id = $2',
    [req.params.snapshotId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Snapshot not found' });
  res.json(rows[0]);
});

// Restore a snapshot
router.post('/:id/snapshots/:snapshotId/restore', async (req, res) => {
  const roomId = req.params.id;

  const { rows: snapRows } = await query(
    'SELECT content FROM snapshots WHERE id = $1 AND room_id = $2',
    [req.params.snapshotId, roomId]
  );
  if (!snapRows.length) return res.status(404).json({ message: 'Snapshot not found' });

  const content = snapRows[0].content;

  const { rows: stateRows } = await query(
    'UPDATE room_state SET content=$1, revision=revision+1, updated_at=NOW() WHERE room_id=$2 RETURNING revision',
    [content, roomId]
  );
  if (!stateRows.length) return res.status(404).json({ message: 'Room state not found' });

  const revision = stateRows[0].revision;
  await setRoomState(roomId, content, revision);

  await query(
    "INSERT INTO snapshots (room_id, content, label) VALUES ($1, $2, 'Restore point')",
    [roomId, content]
  );

  const msg = { type: 'full-replace', roomId, content, revision };
  broadcastToRoom(roomId, msg);
  await publishRoomEvent(roomId, { ...msg, _localOnly: true });

  res.json({ ok: true, revision });
});

// Generate a shareable read-only link
router.post('/:id/share', async (req, res) => {
  const roomId = req.params.id;

  const { rows } = await query('SELECT id FROM rooms WHERE id = $1', [roomId]);
  if (!rows.length) return res.status(404).json({ message: 'Room not found' });

  const token = jwt.sign({ roomId }, process.env.JWT_SECRET, { expiresIn: '30d' });

  await query('UPDATE rooms SET share_token = $1 WHERE id = $2', [token, roomId]);

  const shareUrl = `${process.env.CLIENT_URL || 'http://localhost'}/shared/${token}`;
  res.json({ token, shareUrl });
});

// Rename a room (only the creator). Broadcasts the new name to everyone in the
// room so open editors update live.
router.patch(
  '/:id',
  validate([
    body('name')
      .trim()
      .notEmpty().withMessage('Room name is required')
      .isLength({ min: 1, max: 50 }).withMessage('Room name must be 1–50 characters')
      .not().matches(/<[^>]+>/).withMessage('Room name must not contain HTML'),
  ]),
  async (req, res) => {
    const roomId = req.params.id;
    const { rows } = await query('SELECT created_by FROM rooms WHERE id = $1', [roomId]);
    if (!rows.length) return res.status(404).json({ message: 'Room not found' });
    if (rows[0].created_by !== req.user.sub) {
      return res.status(403).json({ message: 'Only the room creator can rename it' });
    }

    const name = req.body.name.trim();
    await query('UPDATE rooms SET name = $1 WHERE id = $2', [name, roomId]);

    const msg = { type: 'room-renamed', roomId, name };
    broadcastToRoom(roomId, msg);
    await publishRoomEvent(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });

    res.json({ id: roomId, name });
  }
);

// Leave a room — removes only the current user's membership. The room and its
// content stay intact for everyone else; the user can rejoin via the room link
// (the WS join handler re-adds membership, so it reappears on their dashboard).
router.delete('/:id/membership', async (req, res) => {
  await query(
    'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
    [req.params.id, req.user.sub]
  );
  res.status(204).send();
});

// Delete a room (only creator can delete) — destroys it for everyone
router.delete('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT created_by FROM rooms WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Room not found' });
  if (rows[0].created_by !== req.user.sub) {
    return res.status(403).json({ message: 'Only the room creator can delete it' });
  }

  await query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

export default router;
