import { WebSocketServer } from 'ws';
import { verifyToken } from '../auth/jwt.js';
import {
  getRoomState,
  setRoomState,
  getFileState,
  setFileState,
  addRoomMember,
  removeRoomMember,
  getRoomMembers,
  publishToRoom,
  subscriber,
} from '../redis/index.js';
import { query } from '../db/index.js';
import { transform, applyOp, transformAgainstHistory } from '../ot/index.js';
import { enqueueJob, waitForResult } from '../execution/queue.js';
import {
  activeRooms,
  connectedUsers,
  wsActiveConnections,
  wsMessageLatency,
  otOperationsTotal,
  snapshotTotal,
} from '../metrics.js';

// ── In-memory maps (per server instance) ────────────────────────────────────
// roomId → Set<WebSocket>
const roomSockets = new Map();
// ws → { user, roomId }
const socketMeta = new Map();
// roomId → { ops: Array, baseRevision: number }
//   ops[i] was applied at revision baseRevision + i + 1
const roomHistory = new Map();
// roomId → Map<userId, { position, username, color, avatar_url }>
const roomCursors = new Map();
// userId → TokenBucket  (rate-limits code execution)
const executionBuckets = new Map();
// Rooms this instance has subscribed to on Redis
const subscribedRooms = new Set();
// roomId → opsSinceSnapshot count
const opsSinceSnapshot = new Map();
// fileId → { ops: Array, baseRevision: number }  (per-file OT history)
const fileHistory = new Map();
// fileId → Map<userId, { position, username, color, avatar_url }>
const fileCursors = new Map();

const MAX_HISTORY    = 500;
const SNAPSHOT_EVERY = 20; // auto-snapshot after this many ops

const VALID_LANGUAGES = new Set(['javascript', 'python', 'cpp', 'java', 'go']);

// ── Token bucket rate limiter ────────────────────────────────────────────────
class TokenBucket {
  constructor(capacity = 5, refillPerSec = 1 / 60) {
    this.capacity     = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens       = capacity;
    this.lastRefill   = Date.now();
  }

  consume(n = 1) {
    const elapsed = (Date.now() - this.lastRefill) / 1000;
    this.tokens    = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = Date.now();
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}

// ── Colour palette for cursor labels ────────────────────────────────────────
const CURSOR_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
];
function colorForUser(userId) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(roomId, obj, excludeWs = null) {
  const sockets = roomSockets.get(roomId);
  if (!sockets) return;
  const payload = JSON.stringify(obj);
  for (const ws of sockets) {
    if (ws !== excludeWs && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

/** Exported so HTTP route handlers can broadcast to locally-connected sockets. */
export function broadcastToRoom(roomId, obj) {
  broadcast(roomId, obj, null);
}

/** Exported wrapper for publishToRoom so routes don't import redis directly. */
export async function publishRoomEvent(roomId, obj) {
  await publishToRoom(roomId, obj);
}

async function getUsersInRoom(roomId) {
  const ids = await getRoomMembers(roomId);
  if (!ids.length) return [];
  const { rows } = await query(
    'SELECT id, username, avatar_url FROM users WHERE id = ANY($1)',
    [ids]
  );
  return rows;
}

function getHistoryAfter(roomId, revision) {
  const hist = roomHistory.get(roomId);
  if (!hist) return [];
  const sliceFrom = Math.max(0, revision - hist.baseRevision);
  return hist.ops.slice(sliceFrom);
}

function pushHistory(roomId, op) {
  if (!roomHistory.has(roomId)) {
    roomHistory.set(roomId, { ops: [], baseRevision: 0 });
  }
  const hist = roomHistory.get(roomId);
  hist.ops.push(op);
  if (hist.ops.length > MAX_HISTORY) {
    const excess = hist.ops.length - MAX_HISTORY;
    hist.baseRevision += excess;
    hist.ops.splice(0, excess);
  }
}

// ── Per-file OT history (mirrors the room helpers, keyed by fileId) ──────────
function getFileHistoryAfter(fileId, revision) {
  const hist = fileHistory.get(fileId);
  if (!hist) return [];
  const sliceFrom = Math.max(0, revision - hist.baseRevision);
  return hist.ops.slice(sliceFrom);
}

function pushFileHistory(fileId, op) {
  if (!fileHistory.has(fileId)) fileHistory.set(fileId, { ops: [], baseRevision: 0 });
  const hist = fileHistory.get(fileId);
  hist.ops.push(op);
  if (hist.ops.length > MAX_HISTORY) {
    const excess = hist.ops.length - MAX_HISTORY;
    hist.baseRevision += excess;
    hist.ops.splice(0, excess);
  }
}

// Per-file async lock: serializes operations on a file so the read-modify-write
// of its OT state can't interleave at await points (which would let two
// simultaneous edits both read the same revision and diverge).
const fileLocks = new Map();
function withFileLock(fileId, fn) {
  const prev = fileLocks.get(fileId) ?? Promise.resolve();
  const run  = prev.then(fn, fn);
  fileLocks.set(fileId, run.catch(() => {}));
  return run;
}

// Validate a file/folder path: relative, no traversal, reasonable length.
function validPath(p) {
  if (typeof p !== 'string') return false;
  const t = p.trim();
  if (!t || t.length > 255) return false;
  if (t.startsWith('/') || t.includes('..') || t.includes('\\')) return false;
  if (/<[^>]+>/.test(t)) return false;
  return true;
}

// Remove a user's cursor from a file and tell the room so editors drop it.
async function clearFileCursor(roomId, fileId, userId) {
  if (!fileId) return;
  const map = fileCursors.get(fileId);
  if (map) map.delete(userId);
  const msg = { type: 'file-cursor-left', roomId, fileId, userId };
  broadcast(roomId, msg, null);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

async function maybeSnapshot(roomId, content) {
  const count = (opsSinceSnapshot.get(roomId) ?? 0) + 1;
  opsSinceSnapshot.set(roomId, count);
  if (count >= SNAPSHOT_EVERY) {
    opsSinceSnapshot.set(roomId, 0);
    await query(
      "INSERT INTO snapshots (room_id, content, label) VALUES ($1, $2, 'Auto snapshot')",
      [roomId, content]
    );
    snapshotTotal.inc();
  }
}

// ── join-room ─────────────────────────────────────────────────────────────────
async function handleJoinRoom(ws, user, roomId) {
  const { rows } = await query(
    'SELECT id, name, language FROM rooms WHERE id = $1',
    [roomId]
  );
  if (!rows.length) return send(ws, { type: 'error', message: 'Room not found' });

  const meta = socketMeta.get(ws);
  if (meta.roomId) await leaveRoom(ws, user, meta.roomId);

  meta.roomId = roomId;
  if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
  roomSockets.get(roomId).add(ws);

  await addRoomMember(roomId, user.sub);
  await query(
    'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [roomId, user.sub]
  );

  if (!subscribedRooms.has(roomId)) {
    subscribedRooms.add(roomId);
    await subscriber.subscribe(`room:${roomId}`, (raw) => {
      const obj = JSON.parse(raw);
      if (obj._sourceInstance === process.env.INSTANCE_ID) return;
      const { _sourceInstance, ...cleanObj } = obj;
      broadcast(roomId, cleanObj, null);
    });
  }

  let state = await getRoomState(roomId);
  if (!state) {
    const { rows: sr } = await query(
      'SELECT content, revision FROM room_state WHERE room_id = $1',
      [roomId]
    );
    state = sr[0] || { content: '', revision: 0 };
    await setRoomState(roomId, state.content, state.revision);
  }

  const users   = await getUsersInRoom(roomId);
  const cursors = Object.fromEntries(roomCursors.get(roomId) ?? new Map());

  // File tree (multi-file). Client opens a file via `open-file` to load content.
  const { rows: fileRows } = await query(
    'SELECT id, path, is_dir FROM files WHERE room_id = $1 ORDER BY path',
    [roomId]
  );

  // Load the most recent chat history (chronological order) for this room.
  const { rows: chatRows } = await query(
    `SELECT c.user_id, c.content, c.created_at, u.username, u.avatar_url
     FROM chat_messages c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.room_id = $1
     ORDER BY c.created_at DESC
     LIMIT 100`,
    [roomId]
  );
  const chatHistory = chatRows.reverse().map((r) => ({
    type:       'chat-message',
    roomId,
    userId:     r.user_id,
    username:   r.username,
    avatar_url: r.avatar_url,
    content:    r.content,
    timestamp:  r.created_at.toISOString(),
  }));

  send(ws, {
    type:     'room-joined',
    roomId,
    room:     rows[0],
    content:  state.content,
    revision: state.revision,
    users,
    cursors,
    chatHistory,
    files:    fileRows,
  });

  const color     = colorForUser(user.sub);
  const joinedMsg = {
    type: 'user-joined',
    roomId,
    user: { id: user.sub, username: user.username, avatar_url: user.avatar_url, color },
  };
  broadcast(roomId, joinedMsg, ws);
  await publishToRoom(roomId, { ...joinedMsg, _sourceInstance: process.env.INSTANCE_ID });

  activeRooms.set(roomSockets.size);
  connectedUsers.inc();
}

// ── leave-room ────────────────────────────────────────────────────────────────
async function leaveRoom(ws, user, roomId) {
  if (!roomId) return;

  const sockets = roomSockets.get(roomId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) roomSockets.delete(roomId);
  }

  const cursors = roomCursors.get(roomId);
  if (cursors) cursors.delete(user.sub);

  // Drop the user's per-file cursor too (user-left tells clients to remove it).
  const meta = socketMeta.get(ws);
  if (meta?.activeFileId) {
    fileCursors.get(meta.activeFileId)?.delete(user.sub);
    meta.activeFileId = null;
  }

  await removeRoomMember(roomId, user.sub);

  const leftMsg = { type: 'user-left', roomId, userId: user.sub };
  broadcast(roomId, leftMsg, ws);
  await publishToRoom(roomId, { ...leftMsg, _sourceInstance: process.env.INSTANCE_ID });

  activeRooms.set(roomSockets.size);
  connectedUsers.dec();
}

// ── operation ─────────────────────────────────────────────────────────────────
async function handleOperation(ws, user, { roomId, op }) {
  if (!roomId || !op) return;
  const start = Date.now();

  if (!['insert', 'delete'].includes(op.type)) {
    return send(ws, { type: 'error', message: `Unknown op type: ${op.type}` });
  }
  if (typeof op.position !== 'number' || op.position < 0) {
    return send(ws, { type: 'error', message: 'Invalid op position' });
  }

  const state = await getRoomState(roomId);
  if (!state) return send(ws, { type: 'error', message: 'Room state not found' });

  const clientRevision = op.revision ?? state.revision;
  const concurrentOps  = getHistoryAfter(roomId, clientRevision);
  const opWithUser     = { ...op, userId: user.sub };
  const transformed    = transformAgainstHistory(opWithUser, concurrentOps);
  if (!transformed) return;

  const newContent  = applyOp(state.content, transformed);
  const newRevision = state.revision + 1;

  await setRoomState(roomId, newContent, newRevision);
  await query(
    'UPDATE room_state SET content=$1, revision=$2, updated_at=NOW() WHERE room_id=$3',
    [newContent, newRevision, roomId]
  );

  pushHistory(roomId, { ...transformed, revision: newRevision });
  await maybeSnapshot(roomId, newContent);
  otOperationsTotal.inc({ room_id: roomId });

  const outOp = {
    type:   'operation',
    roomId,
    op:     { ...transformed, revision: newRevision },
    userId: user.sub,
  };

  send(ws, outOp);
  broadcast(roomId, outOp, ws);
  await publishToRoom(roomId, { ...outOp, _sourceInstance: process.env.INSTANCE_ID });

  wsMessageLatency.observe(Date.now() - start);
}

// ── cursor-move ───────────────────────────────────────────────────────────────
async function handleCursorMove(ws, user, { roomId, position }) {
  if (!roomId || typeof position !== 'number') return;

  const color = colorForUser(user.sub);
  if (!roomCursors.has(roomId)) roomCursors.set(roomId, new Map());
  roomCursors.get(roomId).set(user.sub, {
    position, username: user.username, avatar_url: user.avatar_url, color,
  });

  const msg = {
    type: 'cursor-update',
    roomId,
    userId:     user.sub,
    username:   user.username,
    avatar_url: user.avatar_url,
    color,
    position,
  };
  broadcast(roomId, msg, ws);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

// ── open-file: load a file's current content + cursors ──────────────────────
async function handleOpenFile(ws, user, { roomId, fileId }) {
  if (!roomId || !fileId) return;
  const { rows } = await query(
    'SELECT id, room_id, path, is_dir, content, revision FROM files WHERE id = $1',
    [fileId]
  );
  if (!rows.length || rows[0].room_id !== roomId || rows[0].is_dir) {
    return send(ws, { type: 'error', message: 'File not found' });
  }
  const file = rows[0];

  let state = await getFileState(fileId);
  if (!state) {
    state = { content: file.content ?? '', revision: file.revision ?? 0 };
    await setFileState(fileId, state.content, state.revision);
  }

  // Switching files: drop our cursor from the previously-open file.
  const meta = socketMeta.get(ws);
  if (meta && meta.activeFileId && meta.activeFileId !== fileId) {
    await clearFileCursor(roomId, meta.activeFileId, user.sub);
  }
  if (meta) meta.activeFileId = fileId;

  const cursors = Object.fromEntries(fileCursors.get(fileId) ?? new Map());
  delete cursors[user.sub];

  send(ws, {
    type:     'file-opened',
    roomId,
    fileId,
    path:     file.path,
    content:  state.content,
    revision: state.revision,
    cursors,
  });
}

// ── file-operation: per-file OT (mirrors handleOperation, keyed by fileId) ──
async function handleFileOperation(ws, user, { roomId, fileId, op }) {
  if (!roomId || !fileId || !op) return;
  const start = Date.now();

  if (!['insert', 'delete'].includes(op.type)) {
    return send(ws, { type: 'error', message: `Unknown op type: ${op.type}` });
  }
  if (typeof op.position !== 'number' || op.position < 0) {
    return send(ws, { type: 'error', message: 'Invalid op position' });
  }

  // Serialize per file so concurrent ops can't race the read-modify-write.
  await withFileLock(fileId, async () => {
    const state = await getFileState(fileId);
    if (!state) return send(ws, { type: 'error', message: 'File state not found' });

    const clientRevision = op.revision ?? state.revision;
    const concurrentOps  = getFileHistoryAfter(fileId, clientRevision);
    const opWithUser     = { ...op, userId: user.sub };
    const transformed    = transformAgainstHistory(opWithUser, concurrentOps);
    if (!transformed) return;

    const newContent  = applyOp(state.content, transformed);
    const newRevision = state.revision + 1;

    await setFileState(fileId, newContent, newRevision);
    await query(
      'UPDATE files SET content = $1, revision = $2, updated_at = NOW() WHERE id = $3',
      [newContent, newRevision, fileId]
    );

    pushFileHistory(fileId, { ...transformed, revision: newRevision });
    otOperationsTotal.inc({ room_id: roomId });

    const outOp = {
      type:   'file-operation',
      roomId,
      fileId,
      op:     { ...transformed, revision: newRevision },
      userId: user.sub,
    };
    send(ws, outOp);
    broadcast(roomId, outOp, ws);
    await publishToRoom(roomId, { ...outOp, _sourceInstance: process.env.INSTANCE_ID });

    wsMessageLatency.observe(Date.now() - start);
  });
}

// ── file-cursor: per-file cursor presence ──────────────────────────────────
async function handleFileCursor(ws, user, { roomId, fileId, position }) {
  if (!roomId || !fileId || typeof position !== 'number') return;
  const color = colorForUser(user.sub);
  if (!fileCursors.has(fileId)) fileCursors.set(fileId, new Map());
  fileCursors.get(fileId).set(user.sub, {
    position, username: user.username, avatar_url: user.avatar_url, color,
  });

  const msg = {
    type: 'file-cursor-update',
    roomId, fileId,
    userId:     user.sub,
    username:   user.username,
    avatar_url: user.avatar_url,
    color,
    position,
  };
  broadcast(roomId, msg, ws);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

// ── create-file / create-folder ────────────────────────────────────────────
async function handleCreateFile(ws, user, { roomId, path, isDir = false }) {
  if (!roomId || !validPath(path)) {
    return send(ws, { type: 'error', message: 'Invalid file path' });
  }
  const clean = path.trim();
  try {
    const { rows } = await query(
      'INSERT INTO files (room_id, path, is_dir) VALUES ($1, $2, $3) RETURNING id, path, is_dir',
      [roomId, clean, !!isDir]
    );
    if (!isDir) await setFileState(rows[0].id, '', 0);
    const msg = { type: 'file-created', roomId, file: rows[0] };
    broadcast(roomId, msg, null);
    await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
  } catch (err) {
    if (err.code === '23505') return send(ws, { type: 'error', message: 'A file with that name already exists' });
    throw err;
  }
}

// ── rename-file (also moves descendants when it's a folder) ─────────────────
async function handleRenameFile(ws, user, { roomId, fileId, newPath }) {
  if (!roomId || !fileId || !validPath(newPath)) {
    return send(ws, { type: 'error', message: 'Invalid file path' });
  }
  const { rows } = await query('SELECT path, is_dir FROM files WHERE id = $1 AND room_id = $2', [fileId, roomId]);
  if (!rows.length) return send(ws, { type: 'error', message: 'File not found' });

  const oldPath = rows[0].path;
  const clean   = newPath.trim();
  try {
    await query('UPDATE files SET path = $1, updated_at = NOW() WHERE id = $2', [clean, fileId]);
    if (rows[0].is_dir) {
      await query(
        'UPDATE files SET path = $1 || substr(path, $3) WHERE room_id = $2 AND path LIKE $4',
        [clean, roomId, oldPath.length + 1, oldPath + '/%']
      );
    }
    const { rows: tree } = await query('SELECT id, path, is_dir FROM files WHERE room_id = $1 ORDER BY path', [roomId]);
    const msg = { type: 'file-renamed', roomId, fileId, path: clean, files: tree };
    broadcast(roomId, msg, null);
    await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
  } catch (err) {
    if (err.code === '23505') return send(ws, { type: 'error', message: 'A file with that name already exists' });
    throw err;
  }
}

// ── delete-file (also deletes descendants when it's a folder) ───────────────
async function handleDeleteFile(ws, user, { roomId, fileId }) {
  if (!roomId || !fileId) return;
  const { rows } = await query('SELECT path, is_dir FROM files WHERE id = $1 AND room_id = $2', [fileId, roomId]);
  if (!rows.length) return;

  let deletedIds = [fileId];
  if (rows[0].is_dir) {
    const { rows: kids } = await query(
      'SELECT id FROM files WHERE room_id = $1 AND path LIKE $2',
      [roomId, rows[0].path + '/%']
    );
    deletedIds = deletedIds.concat(kids.map((k) => k.id));
  }
  await query('DELETE FROM files WHERE id = ANY($1)', [deletedIds]);
  for (const id of deletedIds) { fileHistory.delete(id); fileCursors.delete(id); }

  const msg = { type: 'file-deleted', roomId, fileIds: deletedIds };
  broadcast(roomId, msg, null);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

// ── chat-message ──────────────────────────────────────────────────────────────
async function handleChatMessage(ws, user, { roomId, content }) {
  if (!roomId || !content?.trim()) return;
  const text = String(content).trim().slice(0, 500);

  // Persist so the chat survives reloads/rejoins and is loaded as history.
  const { rows } = await query(
    'INSERT INTO chat_messages (room_id, user_id, content) VALUES ($1, $2, $3) RETURNING created_at',
    [roomId, user.sub, text]
  );

  const msg = {
    type:       'chat-message',
    roomId,
    userId:     user.sub,
    username:   user.username,
    avatar_url: user.avatar_url,
    content:    text,
    timestamp:  rows[0].created_at.toISOString(),
  };
  // excludeWs = null so the sender also receives their own message.
  broadcast(roomId, msg, null);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

// ── language-change ───────────────────────────────────────────────────────────
async function handleLanguageChange(ws, user, { roomId, language }) {
  if (!roomId || !language) return;
  if (!VALID_LANGUAGES.has(language)) {
    return send(ws, { type: 'error', message: `Invalid language: ${language}` });
  }

  await query('UPDATE rooms SET language = $1 WHERE id = $2', [language, roomId]);

  const msg = { type: 'language-changed', roomId, language };
  send(ws, msg);
  broadcast(roomId, msg, ws);
  await publishToRoom(roomId, { ...msg, _sourceInstance: process.env.INSTANCE_ID });
}

// ── execution-request ─────────────────────────────────────────────────────────
async function handleExecutionRequest(ws, user, { roomId, language, code, stdin = '' }) {
  if (!roomId) return;

  if (!executionBuckets.has(user.sub)) {
    executionBuckets.set(user.sub, new TokenBucket(5, 1 / 60));
  }
  if (!executionBuckets.get(user.sub).consume()) {
    return send(ws, {
      type:   'execution-result',
      roomId,
      stderr: 'Rate limit exceeded — wait a moment before running again.',
      stdout: '',
      status: 'Rate Limited',
      statusId: 0,
    });
  }

  const startMsg = { type: 'execution-start', roomId, userId: user.sub };
  broadcast(roomId, startMsg, null);
  await publishToRoom(roomId, { ...startMsg, _sourceInstance: process.env.INSTANCE_ID });

  try {
    const jobId = await enqueueJob({ language, code, stdin });
    const result = await waitForResult(jobId);
    const resultMsg = { type: 'execution-result', roomId, userId: user.sub, ...result };
    broadcast(roomId, resultMsg, null);
    await publishToRoom(roomId, { ...resultMsg, _sourceInstance: process.env.INSTANCE_ID });
  } catch (err) {
    const errMsg = {
      type:    'execution-result',
      roomId,
      userId:  user.sub,
      stdout:  '',
      stderr:  err.message,
      status:  'Error',
      statusId: 0,
    };
    broadcast(roomId, errMsg, null);
  }
}

// ── WebSocket server setup ───────────────────────────────────────────────────
export function setupWebSocket() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url   = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    let user;
    try {
      user = verifyToken(token);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    socketMeta.set(ws, { user, roomId: null, activeFileId: null });
    wsActiveConnections.inc();

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }

      try {
        const meta = socketMeta.get(ws);
        switch (msg.type) {
          case 'join-room':
            await handleJoinRoom(ws, user, msg.roomId);
            break;
          case 'leave-room':
            if (meta.roomId) {
              await leaveRoom(ws, user, meta.roomId);
              meta.roomId = null;
            }
            break;
          case 'operation':
            await handleOperation(ws, user, msg);
            break;
          case 'cursor-move':
            await handleCursorMove(ws, user, msg);
            break;
          case 'open-file':
            await handleOpenFile(ws, user, msg);
            break;
          case 'file-operation':
            await handleFileOperation(ws, user, msg);
            break;
          case 'file-cursor':
            await handleFileCursor(ws, user, msg);
            break;
          case 'create-file':
            await handleCreateFile(ws, user, msg);
            break;
          case 'rename-file':
            await handleRenameFile(ws, user, msg);
            break;
          case 'delete-file':
            await handleDeleteFile(ws, user, msg);
            break;
          case 'chat-message':
            await handleChatMessage(ws, user, msg);
            break;
          case 'language-change':
            await handleLanguageChange(ws, user, msg);
            break;
          case 'execution-request':
            await handleExecutionRequest(ws, user, msg);
            break;
          default:
            send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
      } catch (err) {
        console.error('WS handler error:', err.message);
        send(ws, { type: 'error', message: 'Internal server error' });
      }
    });

    ws.on('close', async () => {
      wsActiveConnections.dec();
      const meta = socketMeta.get(ws);
      if (meta?.roomId) await leaveRoom(ws, user, meta.roomId).catch(() => {});
      socketMeta.delete(ws);
    });

    ws.on('error', (err) => console.error('WebSocket error:', err.message));

    const pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);
    ws.on('close', () => clearInterval(pingTimer));
  });

  console.log('WebSocket server ready on /ws');
  return wss;
}
