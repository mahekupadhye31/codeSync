import { createClient } from 'redis';

// Redis requires separate client instances for pub/sub vs regular commands
export let publisher;
export let subscriber;

export async function connectRedis() {
  publisher = createClient({ url: process.env.REDIS_URL });
  subscriber = publisher.duplicate();

  publisher.on('error', (err) => console.error('Redis publisher error:', err));
  subscriber.on('error', (err) => console.error('Redis subscriber error:', err));

  await publisher.connect();
  await subscriber.connect();
  console.log('Redis connected');
}

// Room state helpers ─────────────────────────────────────────────────────────

const ROOM_TTL_SECONDS = 60 * 60 * 24; // 24 h idle TTL

export async function getRoomState(roomId) {
  const data = await publisher.hGetAll(`room:${roomId}:state`);
  if (!data || data.revision === undefined) return null;
  return { content: data.content, revision: parseInt(data.revision, 10) };
}

export async function setRoomState(roomId, content, revision) {
  await publisher.hSet(`room:${roomId}:state`, { content, revision: String(revision) });
  await publisher.expire(`room:${roomId}:state`, ROOM_TTL_SECONDS);
}

// Per-file hot state for multi-file rooms (each file is its own OT document).
export async function getFileState(fileId) {
  const data = await publisher.hGetAll(`file:${fileId}:state`);
  if (!data || data.revision === undefined) return null;
  return { content: data.content, revision: parseInt(data.revision, 10) };
}

export async function setFileState(fileId, content, revision) {
  await publisher.hSet(`file:${fileId}:state`, { content, revision: String(revision) });
  await publisher.expire(`file:${fileId}:state`, ROOM_TTL_SECONDS);
}

export async function addRoomMember(roomId, userId) {
  await publisher.sAdd(`room:${roomId}:members`, userId);
  await publisher.expire(`room:${roomId}:members`, ROOM_TTL_SECONDS);
}

export async function removeRoomMember(roomId, userId) {
  await publisher.sRem(`room:${roomId}:members`, userId);
}

export async function getRoomMembers(roomId) {
  return publisher.sMembers(`room:${roomId}:members`);
}

export async function publishToRoom(roomId, message) {
  await publisher.publish(`room:${roomId}`, JSON.stringify(message));
}
