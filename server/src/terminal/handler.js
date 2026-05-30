import { WebSocketServer } from 'ws';
import { createRequire }   from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname }   from 'path';
import { verifyToken }     from '../auth/jwt.js';
import { query }           from '../db/index.js';

const require = createRequire(import.meta.url);
const pty     = require('node-pty');

const WORKSPACE = '/workspace';

async function exportRoomFiles(roomId) {
  const dir = join(WORKSPACE, roomId);
  mkdirSync(dir, { recursive: true });

  const { rows } = await query(
    'SELECT path, is_dir, content FROM files WHERE room_id = $1 ORDER BY path',
    [roomId]
  );

  for (const f of rows) {
    if (!f.path) continue;
    const abs = join(dir, f.path);
    if (f.is_dir) {
      mkdirSync(abs, { recursive: true });
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content ?? '', 'utf8');
    }
  }
  return dir;
}

export function setupTerminalWebSocket() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws, req) => {
    const url    = new URL(req.url, 'http://localhost');
    const token  = url.searchParams.get('token');
    const roomId = url.searchParams.get('roomId');

    let user;
    try {
      user = verifyToken(token);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Write room files to workspace so git can operate on them.
    let cwd = WORKSPACE;
    try {
      if (roomId) cwd = await exportRoomFiles(roomId);
    } catch (err) {
      console.error('[terminal] file export failed:', err.message);
    }

    // Pre-configure git identity so commits work without extra setup.
    const gitEnv = {
      GIT_AUTHOR_NAME:     user.username,
      GIT_AUTHOR_EMAIL:    `${user.username}@users.noreply.github.com`,
      GIT_COMMITTER_NAME:  user.username,
      GIT_COMMITTER_EMAIL: `${user.username}@users.noreply.github.com`,
    };

    let proc;
    try {
      proc = pty.spawn('/bin/bash', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, ...gitEnv, TERM: 'xterm-256color', HOME: '/root' },
      });
    } catch (err) {
      console.error('[terminal] pty spawn failed:', err.message);
      ws.close(1011, 'Terminal unavailable');
      return;
    }

    // PTY output → browser
    proc.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    // Browser → PTY
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'resize') {
          proc.resize(
            Math.max(1, Math.min(msg.cols || 80,  500)),
            Math.max(1, Math.min(msg.rows || 24, 200))
          );
        } else if (msg.type === 'input') {
          proc.write(msg.data);
        }
      } catch {
        proc.write(raw.toString());
      }
    });

    ws.on('close', () => { try { proc.kill(); } catch {} });
    proc.onExit(() => { if (ws.readyState !== ws.CLOSED) ws.close(); });
  });

  console.log('Terminal WebSocket ready on /terminal');
  return wss;
}
