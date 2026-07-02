import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth }       from '../hooks/useAuth';
import { useWebSocket }  from '../hooks/useWebSocket';
import { api }           from '../utils/api';
import Navbar            from '../components/Navbar';
import CodeEditor        from '../components/CodeEditor';
import VersionHistory    from '../components/VersionHistory';
import FileExplorer      from '../components/FileExplorer';
import TerminalPanel     from '../components/Terminal';
import { transform }     from '../ot';

const LANG_LABELS = {
  javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', go: 'Go',
};
// Map a file extension to a language for syntax + execution.
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  py: 'python',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  java: 'java',
  go: 'go',
};
function langForPath(path, fallback) {
  const ext = path?.split('.').pop()?.toLowerCase();
  return EXT_LANG[ext] || fallback;
}
// Colored dot per language for the dropdown
const LANG_DOTS = {
  javascript: '#f1e05a',
  python:     '#3572A5',
  cpp:        '#a97bff',
  java:       '#b07219',
  go:         '#00ADD8',
};
const LANG_LIST = Object.keys(LANG_LABELS);

const COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1',
];
function colorForUser(userId) {
  let h = 0;
  for (const c of (userId ?? '')) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

const TYPING_TIMEOUT_MS    = 2000;
const STATUS_TLE           = 5;
const STATUS_COMPILE_ERROR = 6;
const DEFAULT_OUTPUT_HEIGHT = 208; // ~h-52 in px

export default function Room() {
  const { id: roomId } = useParams();
  const { user }       = useAuth();
  const navigate       = useNavigate();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [room,          setRoom]          = useState(null);
  const [users,         setUsers]         = useState([]);
  const [typingUsers,   setTypingUsers]   = useState(new Set());
  const [chatMessages,  setChatMessages]  = useState([]);
  const [chatInput,     setChatInput]     = useState('');
  const [output,        setOutput]        = useState(null);
  const [isRunning,     setIsRunning]     = useState(false);
  const [execUserId,    setExecUserId]    = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [linkCopied,    setLinkCopied]    = useState(false);
  const [language,      setLanguage]      = useState('javascript');
  const [showHistory,   setShowHistory]   = useState(false);
  const [showTerminal,  setShowTerminal]  = useState(false);
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const isTerminalDraggingRef = useRef(false);
  const termDragStartYRef     = useRef(0);
  const termDragStartHRef     = useRef(280);
  const [outputTab,     setOutputTab]     = useState('stdout');
  const [copyTab,       setCopyTab]       = useState(null);
  const [shareFeedback, setShareFeedback] = useState(null);
  const [showLangMenu,  setShowLangMenu]  = useState(false);
  const [outputHeight,  setOutputHeight]  = useState(DEFAULT_OUTPUT_HEIGHT);
  const [renaming,      setRenaming]      = useState(false);
  const [nameDraft,     setNameDraft]     = useState('');
  const [codeCopied,    setCodeCopied]    = useState(false);
  const [files,         setFiles]         = useState([]);
  const [activeFileId,  setActiveFileId]  = useState(null);
  const chatEndRef = useRef(null);

  // ── Editor / OT ──────────────────────────────────────────────────────────
  const editorRef       = useRef(null);
  const revisionRef     = useRef(0);
  const pendingOpsRef   = useRef([]);
  const typingTimersRef = useRef({});

  // Active file + language available to stable callbacks (avoid stale closures).
  const activeFileIdRef = useRef(null);
  const activeLangRef   = useRef('javascript');
  activeFileIdRef.current = activeFileId;
  const activeFile = files.find((f) => f.id === activeFileId) || null;
  const activeLang = langForPath(activeFile?.path, language);
  activeLangRef.current = activeLang;

  // ── Stable keyboard handler refs ──────────────────────────────────────────
  const isRunningRef    = useRef(false);
  const showHistoryRef  = useRef(false);
  isRunningRef.current  = isRunning;
  showHistoryRef.current = showHistory;

  // ── Drag-handle resize state ──────────────────────────────────────────────
  const isDraggingRef   = useRef(false);
  const dragStartYRef   = useRef(0);
  const dragStartHRef   = useRef(DEFAULT_OUTPUT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartHRef.current = outputHeight;
    setIsDragging(true);
    e.preventDefault();
  }, [outputHeight]);

  const handleTermDragMouseDown = useCallback((e) => {
    isTerminalDraggingRef.current = true;
    termDragStartYRef.current = e.clientY;
    termDragStartHRef.current = terminalHeight;
    e.preventDefault();
  }, [terminalHeight]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (isDraggingRef.current) {
        const delta = dragStartYRef.current - e.clientY;
        const newH  = Math.max(80, Math.min(window.innerHeight * 0.6, dragStartHRef.current + delta));
        setOutputHeight(newH);
      }
      if (isTerminalDraggingRef.current) {
        const delta = termDragStartYRef.current - e.clientY;
        const newH  = Math.max(120, Math.min(window.innerHeight * 0.7, termDragStartHRef.current + delta));
        setTerminalHeight(newH);
      }
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      isTerminalDraggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const hasJoinedRef = useRef(false);
  const sendMsgRef   = useRef(() => {});
  const filesRef     = useRef([]);
  filesRef.current   = files;

  // Open a file: clear the previous file's cursors, reset OT state, ask the server.
  const openFile = useCallback((fileId) => {
    if (!fileId) return;
    editorRef.current?.clearCursors();
    activeFileIdRef.current = fileId;
    setActiveFileId(fileId);
    revisionRef.current   = 0;
    pendingOpsRef.current = [];
    sendMsgRef.current({ type: 'open-file', roomId, fileId });
  }, [roomId]);

  const createNode = useCallback((path, isDir) => {
    sendMsgRef.current({ type: 'create-file', roomId, path, isDir });
  }, [roomId]);
  const renameNode = useCallback((fileId, newPath) => {
    sendMsgRef.current({ type: 'rename-file', roomId, fileId, newPath });
  }, [roomId]);
  const deleteNode = useCallback((fileId) => {
    sendMsgRef.current({ type: 'delete-file', roomId, fileId });
  }, [roomId]);

  // ── Message handler ───────────────────────────────────────────────────────
  const onMessage = useCallback((msg) => {
    switch (msg.type) {

      case 'room-joined': {
        setUsers(msg.users ?? []);
        setChatMessages(msg.chatHistory ?? []);
        setFiles(msg.files ?? []);
        if (msg.room?.language) setLanguage(msg.room.language);
        const first = (msg.files ?? []).find((f) => !f.is_dir);
        if (first) openFile(first.id);
        else {
          setActiveFileId(null);
          activeFileIdRef.current = null;
          editorRef.current?.resetContent('');
        }
        break;
      }

      case 'file-opened': {
        if (msg.fileId !== activeFileIdRef.current) break;
        editorRef.current?.resetContent(msg.content);
        revisionRef.current   = msg.revision;
        pendingOpsRef.current = [];
        const cursors = msg.cursors ?? {};
        for (const [uid, cur] of Object.entries(cursors)) {
          if (uid !== user?.sub) editorRef.current?.setCursor(uid, cur.position, cur.username, cur.color);
        }
        break;
      }

      case 'file-operation': {
        if (msg.fileId !== activeFileIdRef.current) break;
        if (msg.userId === user?.sub) {
          pendingOpsRef.current.shift();
          revisionRef.current = msg.op.revision;
        } else {
          let incoming = msg.op;
          for (const pending of pendingOpsRef.current) {
            if (!incoming) break;
            incoming = transform(incoming, pending);
          }
          if (incoming) editorRef.current?.applyRemoteOp(incoming);
          revisionRef.current = msg.op.revision;
        }
        break;
      }

      case 'file-cursor-update':
        if (msg.fileId === activeFileIdRef.current && msg.userId !== user?.sub) {
          editorRef.current?.setCursor(msg.userId, msg.position, msg.username, msg.color);
          markTyping(msg.userId);
        }
        break;

      case 'file-cursor-left':
        if (msg.userId !== user?.sub) {
          editorRef.current?.removeCursor(msg.userId);
          markNotTyping(msg.userId);
        }
        break;

      case 'file-created':
        setFiles((prev) => (prev.some((f) => f.id === msg.file.id) ? prev : [...prev, msg.file]));
        break;

      case 'file-renamed':
        if (msg.files) setFiles(msg.files);
        break;

      case 'file-deleted': {
        const del = new Set(msg.fileIds || []);
        setFiles((prev) => prev.filter((f) => !del.has(f.id)));
        if (del.has(activeFileIdRef.current)) {
          const next = filesRef.current.find((f) => !del.has(f.id) && !f.is_dir);
          if (next) openFile(next.id);
          else {
            setActiveFileId(null);
            activeFileIdRef.current = null;
            editorRef.current?.resetContent('');
          }
        }
        break;
      }

      case 'user-joined':
        setUsers((prev) =>
          prev.find((u) => u.id === msg.user.id) ? prev : [...prev, msg.user]
        );
        break;

      case 'user-left': {
        setUsers((prev) => prev.filter((u) => u.id !== msg.userId));
        editorRef.current?.removeCursor(msg.userId);
        markNotTyping(msg.userId);
        break;
      }

      case 'chat-message':
        setChatMessages((prev) => [...prev.slice(-199), msg]);
        break;

      case 'execution-start':
        setIsRunning(true);
        setExecUserId(msg.userId);
        setOutput(null);
        break;

      case 'execution-result':
        setIsRunning(false);
        setExecUserId(null);
        setOutput(msg);
        break;

      case 'language-changed':
        setLanguage(msg.language);
        break;

      case 'room-renamed':
        setRoom((prev) => (prev ? { ...prev, name: msg.name } : prev));
        break;

      case 'error':
        console.warn('Server WS error:', msg.message);
        break;
    }
  }, [user, openFile]);

  // ── Typing pulse helpers ──────────────────────────────────────────────────
  function markTyping(userId) {
    clearTimeout(typingTimersRef.current[userId]);
    setTypingUsers((prev) => { const next = new Set(prev); next.add(userId); return next; });
    typingTimersRef.current[userId] = setTimeout(() => markNotTyping(userId), TYPING_TIMEOUT_MS);
  }

  function markNotTyping(userId) {
    clearTimeout(typingTimersRef.current[userId]);
    setTypingUsers((prev) => { const next = new Set(prev); next.delete(userId); return next; });
  }

  // ── useWebSocket ──────────────────────────────────────────────────────────
  const { send, isConnected, reconnectFailed } = useWebSocket(onMessage, () => {
    if (hasJoinedRef.current) sendMsgRef.current({ type: 'join-room', roomId });
  });

  useEffect(() => { sendMsgRef.current = send; }, [send]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.getRoom(roomId)
      .then((r) => { setRoom(r); setLanguage(r.language ?? 'javascript'); setLoading(false); })
      .catch(() => navigate('/dashboard', { replace: true }));
  }, [roomId, navigate]);

  useEffect(() => {
    if (!loading && isConnected && !hasJoinedRef.current) {
      hasJoinedRef.current = true;
      send({ type: 'join-room', roomId });
    }
  }, [loading, isConnected, roomId, send]);

  useEffect(() => {
    return () => {
      hasJoinedRef.current = false;
      send({ type: 'leave-room', roomId });
    };
  }, [roomId, send]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (output) localStorage.setItem(`cs:output:${roomId}`, JSON.stringify(output));
  }, [output, roomId]);

  useEffect(() => {
    const saved = localStorage.getItem(`cs:output:${roomId}`);
    if (saved) { try { setOutput(JSON.parse(saved)); } catch {} }
  }, [roomId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (!isRunningRef.current) runCodeHandler();
      }
      if (e.ctrlKey && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        saveSnapshotHandler();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        setShowHistory((p) => !p);
      }
      if (e.key === 'Escape' && showHistoryRef.current) {
        setShowHistory(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleLocalChange = useCallback((newDoc, op) => {
    const fileId = activeFileIdRef.current;
    if (!op || !fileId) return;
    const outOp = { ...op, revision: revisionRef.current, userId: user?.sub };
    send({ type: 'file-operation', roomId, fileId, op: outOp });
    pendingOpsRef.current.push(outOp);
  }, [roomId, send, user]);

  const handleCursorMove = useCallback((position) => {
    const fileId = activeFileIdRef.current;
    if (!fileId) return;
    send({ type: 'file-cursor', roomId, fileId, position });
  }, [roomId, send]);

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    send({ type: 'chat-message', roomId, content: chatInput.trim() });
    setChatInput('');
  };

  function runCodeHandler() {
    const code = editorRef.current?.getContent() ?? '';
    send({ type: 'execution-request', roomId, language: activeLangRef.current, code });
  }

  async function saveSnapshotHandler() {
    try { await api.createSnapshot(roomId, 'Manual save'); } catch {}
  }

  const submitRename = async () => {
    const newName = nameDraft.trim();
    setRenaming(false);
    if (!newName || newName === room?.name) return;
    try {
      await api.renameRoom(roomId, newName);
      setRoom((prev) => (prev ? { ...prev, name: newName } : prev));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    setShowLangMenu(false);
    send({ type: 'language-change', roomId, language: lang });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const copyCode = () => {
    if (!room?.join_code) return;
    navigator.clipboard.writeText(room.join_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const generateShareLink = async () => {
    setShareFeedback('copying');
    try {
      const { shareUrl } = await api.createShare(roomId);
      await navigator.clipboard.writeText(shareUrl);
      setShareFeedback('copied');
      setTimeout(() => setShareFeedback(null), 2500);
    } catch {
      setShareFeedback(null);
    }
  };

  const copyOutputTab = (text, tab) => {
    navigator.clipboard.writeText(text ?? '');
    setCopyTab(tab);
    setTimeout(() => setCopyTab(null), 1500);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 flex flex-col">
        <Navbar />
        {/* Toolbar skeleton */}
        <div className="h-11 bg-dark-800 border-b border-dark-600 flex items-center px-4 gap-3 shrink-0">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="flex-1" />
          <div className="skeleton h-7 w-16 rounded" />
          <div className="skeleton h-7 w-12 rounded" />
          <div className="skeleton h-7 w-14 rounded" />
        </div>
        {/* Editor + sidebar skeleton */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 bg-dark-900 p-4 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton h-4 rounded" style={{ width: `${45 + (i * 7) % 50}%` }} />
            ))}
          </div>
          <div className="w-64 border-l border-dark-600 bg-dark-800 p-4 space-y-3">
            <div className="skeleton h-3 w-24 rounded" />
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="skeleton w-5 h-5 rounded-full" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const execUser     = users.find((u) => u.id === execUserId);
  const isTLE        = output?.statusId === STATUS_TLE;
  const isCompileErr = output?.statusId === STATUS_COMPILE_ERROR;

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      <Navbar />

      {/* ── Reconnect failure banner ── */}
      {reconnectFailed && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-900/40 border-b border-red-700/40 text-red-300 text-sm shrink-0">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Connection lost — retrying in the background.
          <button onClick={() => window.location.reload()} className="ml-auto text-red-200 hover:text-white underline text-xs shrink-0">
            Reload to rejoin
          </button>
        </div>
      )}

      {/* ── Room toolbar ── */}
      <div className="h-11 bg-dark-800 border-b border-dark-600 flex items-center px-4 gap-2 shrink-0">
        {room?.created_by === user?.sub && renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') { setNameDraft(room?.name ?? ''); setRenaming(false); }
            }}
            onBlur={submitRename}
            maxLength={50}
            className="bg-dark-700 border border-dark-500 rounded px-2 py-0.5 text-sm text-white w-44 focus:outline-none focus:border-blue-500"
          />
        ) : (
          <div className="flex items-center gap-1 group/name">
            <h2 className="font-medium text-white text-sm truncate max-w-[12rem]">{room?.name}</h2>
            {room?.created_by === user?.sub && (
              <button
                onClick={() => { setNameDraft(room?.name ?? ''); setRenaming(true); }}
                title="Rename room"
                className="text-gray-500 hover:text-white p-0.5 rounded opacity-0 group-hover/name:opacity-100 transition-opacity"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Active file's language (auto-detected from extension) */}
        <span
          className="text-xs text-gray-400 bg-dark-700 px-2 py-1 rounded flex items-center gap-1.5"
          title="Language — detected from the file extension"
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: LANG_DOTS[activeLang] ?? '#888' }} />
          {LANG_LABELS[activeLang] ?? activeLang}
        </span>

        {/* Connection indicator */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
          title={isConnected ? 'Connected' : 'Reconnecting…'}
        />

        {/* Presence stack */}
        <div className="flex items-center gap-2 ml-1">
          <div className="flex -space-x-1.5">
            {users.slice(0, 6).map((u) => {
              const color  = colorForUser(u.id);
              const typing = typingUsers.has(u.id);
              return (
                <div key={u.id} className="relative" title={`@${u.username}`}>
                  <img
                    src={u.avatar_url}
                    alt={u.username}
                    className="w-6 h-6 rounded-full"
                    style={{ border: `2px solid ${color}` }}
                  />
                  {typing && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-pulse"
                      style={{ background: color }}
                    />
                  )}
                </div>
              );
            })}
            {users.length > 6 && (
              <div className="w-6 h-6 rounded-full bg-dark-600 border-2 border-dark-800 flex items-center justify-center text-[10px] text-gray-400">
                +{users.length - 6}
              </div>
            )}
          </div>
          <span className="text-xs text-gray-500 hidden sm:block">{users.length} online</span>
        </div>

        {/* Copyable join code — share this so others can "Join by code" */}
        {room?.join_code && (
          <button
            onClick={copyCode}
            title="Copy join code — others can use it in &quot;Join by code&quot;"
            className="text-xs text-gray-400 hover:text-white bg-dark-700 hover:bg-dark-600 px-2 py-1 rounded flex items-center gap-1.5 transition-colors"
          >
            <span className="text-gray-500">Code</span>
            <span className="font-mono tracking-wider text-gray-200">
              {room.join_code.slice(0, 3)}-{room.join_code.slice(3)}
            </span>
            {codeCopied ? (
              <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        )}

        <div className="flex-1" />

        {/* Terminal toggle */}
        <button
          onClick={() => {
            setShowTerminal((p) => !p);
            setTerminalEverOpened(true);
          }}
          title="Toggle terminal (git, bash)"
          className={`text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-colors ${
            showTerminal ? 'bg-dark-600 text-white' : 'text-gray-400 hover:text-white hover:bg-dark-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="hidden sm:block">Terminal</span>
        </button>

        {/* History toggle */}
        <button
          onClick={() => setShowHistory((p) => !p)}
          title="Version History (Ctrl+Shift+H)"
          className={`text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded transition-colors ${
            showHistory ? 'bg-dark-600 text-white' : 'text-gray-400 hover:text-white hover:bg-dark-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="hidden sm:block">History</span>
        </button>

        {/* Share read-only link */}
        <button
          onClick={generateShareLink}
          disabled={shareFeedback === 'copying'}
          title="Generate & copy read-only share link"
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-dark-700 transition-colors disabled:opacity-50"
        >
          {shareFeedback === 'copied' ? (
            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          )}
          <span className="hidden sm:block">
            {shareFeedback === 'copied' ? 'Copied!' : shareFeedback === 'copying' ? '…' : 'Share'}
          </span>
        </button>

        {/* Copy room link */}
        <button
          onClick={copyLink}
          title="Copy room link"
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-dark-700 transition-colors"
        >
          {linkCopied ? (
            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
          <span className="hidden sm:block">{linkCopied ? 'Copied!' : 'Link'}</span>
        </button>

        {/* Run button */}
        <button
          onClick={runCodeHandler}
          disabled={isRunning}
          title="Run code (Ctrl+Enter)"
          className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
        >
          {isRunning ? (
            <>
              <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              {execUser ? `${execUser.username} running…` : 'Running…'}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              Run
            </>
          )}
        </button>
      </div>

      {/* ── Main layout ── */}
      <div className="flex-1 flex overflow-hidden" onClick={() => showLangMenu && setShowLangMenu(false)}>

        {/* File explorer */}
        <FileExplorer
          files={files}
          activeFileId={activeFileId}
          onSelect={openFile}
          onCreate={createNode}
          onRename={renameNode}
          onDelete={deleteNode}
        />

        {/* Editor pane */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <CodeEditor
              language={activeLang}
              editorRef={editorRef}
              onChange={handleLocalChange}
              onCursorMove={handleCursorMove}
            />
          </div>

          {/* ── Output panel with drag-handle resize ── */}
          {(output || isRunning) && (
            <>
              {/* Drag handle */}
              <div
                className={`drag-handle${isDragging ? ' dragging' : ''}`}
                onMouseDown={handleDragMouseDown}
                title="Drag to resize output panel"
              />

              <div
                className="bg-[#0d1117] border-t border-dark-600 flex flex-col shrink-0 overflow-hidden"
                style={{ height: outputHeight }}
              >
                {/* Panel header + tabs */}
                <div className="flex items-center border-b border-dark-700 shrink-0">
                  {(['stdout', 'stderr', 'compile']).map((tab) => {
                    const content    = tab === 'stdout' ? output?.stdout : tab === 'stderr' ? output?.stderr : output?.compile_output;
                    const hasContent = !isRunning && !!content;
                    return (
                      <button
                        key={tab}
                        onClick={() => setOutputTab(tab)}
                        className={`px-3 py-2 text-xs flex items-center gap-1.5 border-b-2 transition-colors ${
                          outputTab === tab
                            ? 'border-blue-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {tab === 'stdout'  && 'Output'}
                        {tab === 'stderr'  && 'Errors'}
                        {tab === 'compile' && 'Compiler'}
                        {hasContent && (
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            tab === 'stdout'  ? 'bg-green-400' :
                            tab === 'stderr'  ? 'bg-red-400'   : 'bg-amber-400'
                          }`} />
                        )}
                      </button>
                    );
                  })}

                  <div className="flex-1" />

                  {output?.status && !isRunning && (
                    <span className={`text-xs px-2 py-0.5 rounded-full mr-2 ${
                      output.status === 'Accepted'
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-red-900/50 text-red-300'
                    }`}>
                      {output.status}
                    </span>
                  )}
                  {output?.time && !isRunning && (
                    <span className="text-xs text-gray-600 mr-2">{output.time}s</span>
                  )}

                  {!isRunning && (
                    <button
                      onClick={() => {
                        const text = outputTab === 'stdout' ? output?.stdout
                          : outputTab === 'stderr' ? output?.stderr : output?.compile_output;
                        copyOutputTab(text, outputTab);
                      }}
                      title="Copy"
                      className="text-gray-600 hover:text-gray-400 mr-1 p-1 rounded"
                    >
                      {copyTab === outputTab ? (
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => { setOutput(null); localStorage.removeItem(`cs:output:${roomId}`); }}
                    className="text-gray-600 hover:text-gray-400 text-xs mr-3"
                    title="Clear output"
                  >
                    ✕
                  </button>
                </div>

                {/* Banners */}
                {!isRunning && isTLE && (
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-900/30 border-b border-amber-700/40 text-xs text-amber-300 shrink-0">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Time Limit Exceeded — your code ran too long
                  </div>
                )}
                {!isRunning && isCompileErr && (
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-red-900/30 border-b border-red-700/40 text-xs text-red-300 shrink-0">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    Compilation Error — check the Compiler tab for details
                  </div>
                )}

                {/* Tab content */}
                <div className="flex-1 overflow-auto scrollbar-thin">
                  {isRunning ? (
                    <div className="flex items-center gap-2 p-4 text-xs text-gray-500">
                      <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                      {execUser ? `Running by @${execUser.username}…` : 'Waiting for Judge0…'}
                    </div>
                  ) : (
                    (() => {
                      const text = outputTab === 'stdout' ? output?.stdout
                        : outputTab === 'stderr' ? output?.stderr : output?.compile_output;
                      if (!text) return (
                        <p className="p-4 text-xs text-gray-600 italic">
                          No {outputTab === 'stdout' ? 'output' : outputTab === 'stderr' ? 'errors' : 'compiler output'}
                        </p>
                      );
                      const colorClass = outputTab === 'stdout' ? 'text-green-300'
                        : outputTab === 'stderr' ? 'text-red-300' : 'text-amber-300';
                      return <pre className={`p-4 text-xs font-mono whitespace-pre-wrap ${colorClass}`}>{text}</pre>;
                    })()
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Terminal panel ── */}
          {terminalEverOpened && (
            <div
              className="flex-col shrink-0 border-t border-dark-600 bg-[#0d1117]"
              style={{ display: showTerminal ? 'flex' : 'none', height: terminalHeight }}
            >
              <div
                className="drag-handle"
                onMouseDown={handleTermDragMouseDown}
                title="Drag to resize terminal"
              />
              <div className="flex items-center border-b border-dark-700 px-3 py-1.5 shrink-0">
                <span className="text-xs text-gray-400 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 002 2z" />
                  </svg>
                  Terminal
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setShowTerminal(false)}
                  className="text-gray-600 hover:text-gray-400 text-xs"
                  title="Close terminal"
                >✕</button>
              </div>
              <div className="flex-1 overflow-hidden">
                <TerminalPanel roomId={roomId} />
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}

        <div className="w-64 border-l border-dark-600 flex flex-col bg-dark-800 shrink-0">
          {/* Online users */}
          <div className="px-4 py-3 border-b border-dark-700">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
              Online · {users.length}
            </div>
            <div className="space-y-2 max-h-36 overflow-y-auto scrollbar-thin">
              {users.map((u) => {
                const color  = colorForUser(u.id);
                const typing = typingUsers.has(u.id);
                const isMe   = u.id === user?.sub;
                return (
                  <div key={u.id} className="flex items-center gap-2">
                    <div className="relative shrink-0">
                      <img
                        src={u.avatar_url}
                        alt={u.username}
                        className="w-5 h-5 rounded-full"
                        style={{ border: `1.5px solid ${color}` }}
                      />
                      {typing && (
                        <span
                          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
                          style={{ background: color }}
                        />
                      )}
                    </div>
                    <span className="text-xs text-gray-300 truncate">
                      @{u.username}{isMe ? ' (you)' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chat */}
          <div className="px-4 py-2.5 border-b border-dark-700 text-xs font-medium text-gray-400 uppercase tracking-wider">
            Chat
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
            {chatMessages.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">No messages yet</p>
            )}
            {chatMessages.map((m, i) => {
              const isMe = m.userId === user?.sub;
              return (
                <div key={i} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <img src={m.avatar_url} alt={m.username} className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
                  <div className={`flex flex-col min-w-0 max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-baseline gap-1.5 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-xs font-medium text-gray-300 truncate">{isMe ? 'You' : `@${m.username}`}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 px-2.5 py-1.5 break-words rounded-lg ${
                      isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-dark-700 text-gray-200 rounded-tl-sm'
                    }`}>
                      {m.content}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendChat} className="p-3 border-t border-dark-700">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message…"
              maxLength={500}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </form>
        </div>
      </div>

      {/* ── Version History drawer ── */}
      {showHistory && (
        <div className="drawer-enter">
          <VersionHistory
            roomId={roomId}
            currentContent={editorRef.current?.getContent() ?? ''}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}
    </div>
  );
}
