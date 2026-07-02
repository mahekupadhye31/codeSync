import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import Navbar from '../components/Navbar';

const LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'go'];
const LANG_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', go: 'Go' };
const LANG_COLORS = {
  javascript: 'bg-yellow-500/20 text-yellow-300',
  python:     'bg-blue-500/20 text-blue-300',
  cpp:        'bg-purple-500/20 text-purple-300',
  java:       'bg-orange-500/20 text-orange-300',
  go:         'bg-cyan-500/20 text-cyan-300',
};

// ── Relative time helper ──────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Create room modal ─────────────────────────────────────────────────────────
function CreateRoomModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const room = await api.createRoom(name.trim(), language);
      onCreate(room);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-6">Create a new room</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Room name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome project"
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              autoFocus
              maxLength={50}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{LANG_LABELS[l]}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-dark-500 text-gray-300 hover:bg-dark-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating…' : 'Create room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Join-by-code modal ──────────────────────────────────────────────────────
function JoinRoomModal({ onClose }) {
  const navigate = useNavigate();
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    setLoading(true);
    setError('');
    // A full link or pasted UUID resolves directly; otherwise treat it as a join code.
    const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    try {
      let id;
      if (uuid) {
        await api.getRoom(uuid[0]);
        id = uuid[0];
      } else {
        const room = await api.resolveCode(raw.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        id = room.id;
      }
      navigate(`/room/${id}`);
    } catch {
      setError('No room found — check the code or link and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-2">Join a room</h2>
        <p className="text-sm text-gray-400 mb-6">Enter a room code (e.g. ABC-123) or paste a room link.</p>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Room code or link"
            className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            autoFocus
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-dark-500 text-gray-300 hover:bg-dark-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Joining…' : 'Join room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-5 w-16 rounded-full" />
      </div>
      <div className="skeleton h-3 w-1/3 rounded" />
      <div className="flex items-center gap-2">
        <div className="skeleton w-5 h-5 rounded-full" />
        <div className="skeleton h-3 w-20 rounded" />
      </div>
    </div>
  );
}

// ── Empty state SVG ───────────────────────────────────────────────────────────
function EmptyState({ onCreateClick }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <svg
        className="w-40 h-40 mb-6 opacity-80"
        viewBox="0 0 200 160"
        fill="none"
        aria-hidden="true"
      >
        {/* Editor window */}
        <rect x="20" y="20" width="160" height="120" rx="10" fill="#161b22" stroke="#30363d" strokeWidth="1.5" />
        {/* Title bar */}
        <rect x="20" y="20" width="160" height="28" rx="10" fill="#21262d" />
        <rect x="20" y="38" width="160" height="10" fill="#21262d" />
        <circle cx="38" cy="34" r="5" fill="#ff5f57" />
        <circle cx="54" cy="34" r="5" fill="#febc2e" />
        <circle cx="70" cy="34" r="5" fill="#28c840" />
        {/* Code lines */}
        <rect x="36" y="62" width="50" height="5" rx="2" fill="#388bfd" opacity="0.7" />
        <rect x="92" y="62" width="30" height="5" rx="2" fill="#79c0ff" opacity="0.5" />
        <rect x="44" y="76" width="70" height="5" rx="2" fill="#a5d6ff" opacity="0.4" />
        <rect x="44" y="90" width="45" height="5" rx="2" fill="#a5d6ff" opacity="0.3" />
        <rect x="36" y="104" width="55" height="5" rx="2" fill="#56d364" opacity="0.5" />
        <rect x="96" y="104" width="25" height="5" rx="2" fill="#a5d6ff" opacity="0.3" />
        {/* Cursor blink */}
        <rect x="36" y="118" width="2" height="8" rx="1" fill="#58a6ff">
          <animate attributeName="opacity" values="1;0;1" dur="1.2s" repeatCount="indefinite" />
        </rect>
      </svg>

      <h3 className="text-lg font-medium text-white mb-2">No rooms yet</h3>
      <p className="text-gray-400 text-sm mb-6 max-w-xs">
        Create a room to start collaborating in real time with your team.
      </p>
      <button
        onClick={onCreateClick}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-2.5 rounded-xl"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Create your first room
      </button>
    </div>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, onDelete, onLeave, currentUserId }) {
  const navigate = useNavigate();
  const isOwner = room.created_by === currentUserId;

  return (
    <div
      onClick={() => navigate(`/room/${room.id}`)}
      className="bg-dark-800 border border-dark-600 rounded-xl p-5 hover:border-blue-500/50 hover:bg-dark-700 cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors truncate pr-2">
          {room.name}
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${LANG_COLORS[room.language] || 'bg-gray-700 text-gray-300'}`}>
          {LANG_LABELS[room.language] || room.language}
        </span>
      </div>

      <p className="text-xs text-gray-500 mb-3">{timeAgo(room.created_at)}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {room.creator_avatar && (
            <img src={room.creator_avatar} alt={room.creator_username} className="w-5 h-5 rounded-full" />
          )}
          <span className="text-xs text-gray-500">@{room.creator_username}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Leave: removes the room from your dashboard only; rejoin via its link */}
          <button
            onClick={(e) => { e.stopPropagation(); onLeave(room.id); }}
            className="text-gray-600 hover:text-amber-400 p-1 rounded"
            title="Leave room (removes it from your list — rejoin anytime with the room link)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
          {isOwner && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(room.id); }}
              className="text-gray-600 hover:text-red-400 p-1 rounded"
              title="Delete room for everyone"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [rooms,      setRooms]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin,   setShowJoin]   = useState(false);
  const [error,      setError]      = useState('');
  const [search,     setSearch]     = useState('');

  useEffect(() => {
    api.listRooms()
      .then(setRooms)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(q));
  }, [rooms, search]);

  const handleCreate = (room) => {
    setRooms((prev) => [room, ...prev]);
    setShowCreate(false);
  };

  const handleDelete = async (roomId) => {
    if (!confirm('Delete this room? All snapshots will be lost.')) return;
    try {
      await api.deleteRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleLeave = async (roomId) => {
    if (!confirm('Leave this room? It will be removed from your dashboard. You can rejoin anytime using the room link.')) return;
    try {
      await api.leaveRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Rooms</h1>
            <p className="text-gray-400 text-sm mt-1">Join a room or create one to start coding together.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowJoin(true)}
              className="flex items-center gap-2 border border-dark-500 text-gray-200 hover:bg-dark-700 font-medium px-4 py-2.5 rounded-xl"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h5a3 3 0 013 3v1" />
              </svg>
              Join by code
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2.5 rounded-xl"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New room
            </button>
          </div>
        </div>

        {/* Search */}
        {!loading && rooms.length > 0 && (
          <div className="relative mb-6">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms…"
              className="w-full max-w-sm bg-dark-800 border border-dark-600 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 max-w-sm"
                style={{ right: `calc(100% - min(100%, 24rem) + 0.75rem)` }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">{error}</div>
        ) : rooms.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreate(true)} />
        ) : filteredRooms.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-sm">No rooms match <span className="text-gray-300">"{search}"</span></p>
            <button onClick={() => setSearch('')} className="mt-3 text-blue-400 hover:text-blue-300 text-sm">
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                onDelete={handleDelete}
                onLeave={handleLeave}
                currentUserId={user?.sub}
              />
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateRoomModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
      {showJoin && <JoinRoomModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}
