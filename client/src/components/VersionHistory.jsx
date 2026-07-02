import { useState, useEffect, useCallback } from 'react';
import DiffMatchPatch from 'diff-match-patch';
import { api } from '../utils/api';

const dmp = new DiffMatchPatch();

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DiffView({ before, after }) {
  const diffs = dmp.diff_main(before ?? '', after ?? '');
  dmp.diff_cleanupSemantic(diffs);
  return (
    <pre className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed">
      {diffs.map(([op, text], i) => {
        if (op === 1)  return <mark key={i} className="bg-green-900/60 text-green-300 rounded-sm">{text}</mark>;
        if (op === -1) return <s    key={i} className="bg-red-900/40  text-red-400">{text}</s>;
        return <span key={i} className="text-gray-400">{text}</span>;
      })}
    </pre>
  );
}

export default function VersionHistory({ roomId, currentContent, onClose }) {
  const [snapshots,      setSnapshots]      = useState([]);
  const [selected,       setSelected]       = useState(null);
  const [selectedContent, setSelectedContent] = useState(null);
  const [showDiff,       setShowDiff]       = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [restoring,      setRestoring]      = useState(false);

  const loadSnapshots = useCallback(async () => {
    try {
      const snaps = await api.getSnapshots(roomId);
      setSnapshots(snaps);
    } catch {}
  }, [roomId]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const selectSnapshot = async (snap) => {
    setSelected(snap);
    setSelectedContent(null);
    setConfirmRestore(false);
    setShowDiff(false);
    try {
      const full = await api.getSnapshot(roomId, snap.id);
      setSelectedContent(full.content);
    } catch {
      setSelectedContent('');
    }
  };

  const saveNow = async () => {
    setSaving(true);
    try {
      await api.createSnapshot(roomId, 'Manual save');
      await loadSnapshots();
    } catch {} finally {
      setSaving(false);
    }
  };

  const doRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      await api.restoreSnapshot(roomId, selected.id);
      onClose();
    } catch {
      setRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div
        className="ml-auto w-[720px] max-w-full h-full bg-dark-800 border-l border-dark-600 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700 shrink-0">
          <h3 className="text-sm font-medium text-white">Version History</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={saveNow}
              disabled={saving}
              className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors"
            >
              {saving ? 'Saving…' : 'Save now'}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-white rounded transition-colors"
              title="Close (Esc)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Snapshot list */}
          <div className="w-52 border-r border-dark-700 overflow-y-auto shrink-0 bg-dark-900/30">
            {snapshots.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-10 px-3 leading-relaxed">
                No snapshots yet.<br />
                Run code or press <kbd className="font-mono bg-dark-700 px-1 py-0.5 rounded text-[10px]">Ctrl+S</kbd> to create one.
              </p>
            ) : (
              snapshots.map((snap) => (
                <button
                  key={snap.id}
                  onClick={() => selectSnapshot(snap)}
                  className={`w-full text-left px-3 py-2.5 border-b border-dark-700 hover:bg-dark-700 transition-colors ${
                    selected?.id === snap.id ? 'bg-dark-700 border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  <div className="text-xs text-gray-200 font-medium truncate">
                    {snap.label || 'Auto snapshot'}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {formatRelativeTime(snap.created_at)}
                  </div>
                  {snap.size_bytes != null && (
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {snap.size_bytes < 1024
                        ? `${snap.size_bytes} B`
                        : `${(snap.size_bytes / 1024).toFixed(1)} KB`}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Content / diff pane */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selected ? (
              <>
                {/* Pane toolbar */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-dark-700 shrink-0 bg-dark-800">
                  <button
                    onClick={() => setShowDiff(false)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      !showDiff ? 'bg-dark-600 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Snapshot
                  </button>
                  <button
                    onClick={() => setShowDiff(true)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      showDiff ? 'bg-dark-600 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Diff vs now
                  </button>
                  <div className="flex-1" />
                  {confirmRestore ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-amber-400">Replace current code?</span>
                      <button
                        onClick={doRestore}
                        disabled={restoring}
                        className="text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-2.5 py-1 rounded transition-colors"
                      >
                        {restoring ? 'Restoring…' : 'Yes, restore'}
                      </button>
                      <button
                        onClick={() => setConfirmRestore(false)}
                        className="text-xs text-gray-500 hover:text-white px-2 py-1 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRestore(true)}
                      className="text-xs bg-amber-800 hover:bg-amber-700 text-white px-3 py-1 rounded transition-colors"
                    >
                      Restore
                    </button>
                  )}
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-auto bg-[#0d1117]">
                  {selectedContent === null ? (
                    <div className="flex items-center justify-center h-full gap-2 text-xs text-gray-500">
                      <div className="w-4 h-4 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                      Loading…
                    </div>
                  ) : showDiff ? (
                    <DiffView before={selectedContent} after={currentContent} />
                  ) : (
                    <pre className="p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                      {selectedContent || <span className="text-gray-600 italic">Empty snapshot</span>}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-500">Select a snapshot to preview</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
