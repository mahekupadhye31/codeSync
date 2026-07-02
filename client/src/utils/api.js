const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('cs_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  getMe: () => apiFetch('/auth/me'),

  // Rooms
  createRoom:   (name, language) =>
    apiFetch('/rooms', { method: 'POST', body: JSON.stringify({ name, language }) }),
  listRooms:    () => apiFetch('/rooms'),
  getRoom:      (id) => apiFetch(`/rooms/${id}`),
  resolveCode:  (code) => apiFetch(`/rooms/code/${encodeURIComponent(code)}`),
  deleteRoom:   (id) => apiFetch(`/rooms/${id}`, { method: 'DELETE' }),
  renameRoom:   (id, name) => apiFetch(`/rooms/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  leaveRoom:    (id) => apiFetch(`/rooms/${id}/membership`, { method: 'DELETE' }),

  // Snapshots
  getSnapshots:    (roomId) => apiFetch(`/rooms/${roomId}/snapshots`),
  getSnapshot:     (roomId, snapId) => apiFetch(`/rooms/${roomId}/snapshots/${snapId}`),
  createSnapshot:  (roomId, label) =>
    apiFetch(`/rooms/${roomId}/snapshots`, { method: 'POST', body: JSON.stringify({ label }) }),
  restoreSnapshot: (roomId, snapId) =>
    apiFetch(`/rooms/${roomId}/snapshots/${snapId}/restore`, { method: 'POST' }),

  // Sharing
  createShare: (roomId) =>
    apiFetch(`/rooms/${roomId}/share`, { method: 'POST' }),
  getShared: (token) =>
    fetch(`${API_BASE}/rooms/shared/${token}`).then((r) => {
      if (!r.ok) throw new Error('Not found');
      return r.json();
    }),
};
