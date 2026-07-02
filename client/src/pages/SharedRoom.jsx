import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { indentOnInput, bracketMatching, foldGutter } from '@codemirror/language';
import { oneDark }    from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python }     from '@codemirror/lang-python';
import { cpp }        from '@codemirror/lang-cpp';
import { java }       from '@codemirror/lang-java';
import { api }        from '../utils/api';

const LANG_LABELS = {
  javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', go: 'Go',
};

function getLangExt(language) {
  switch (language) {
    case 'python': return python();
    case 'cpp':    return cpp();
    case 'java':   return java();
    default:       return javascript({ jsx: true });
  }
}

export default function SharedRoom() {
  const { token } = useParams();
  const [room,  setRoom]  = useState(null);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);
  const viewRef      = useRef(null);

  useEffect(() => {
    api.getShared(token)
      .then(setRoom)
      .catch(() => setError('This shared link is invalid or has expired.'));
  }, [token]);

  useEffect(() => {
    if (!room || !containerRef.current) return;

    const state = EditorState.create({
      doc: room.content ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        foldGutter(),
        oneDark,
        getLangExt(room.language),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({
          '&':            { height: '100%' },
          '.cm-scroller': { overflow: 'auto', height: '100%' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
  }, [room]);

  if (error) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className="w-12 h-12 bg-dark-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h2 className="text-white font-medium mb-2">Link not found</h2>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
            Go to CodeSync
          </Link>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      {/* Toolbar */}
      <div className="h-11 bg-dark-800 border-b border-dark-600 flex items-center px-4 gap-3 shrink-0">
        <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm font-semibold transition-colors shrink-0">
          CodeSync
        </Link>
        <span className="text-dark-600 text-lg shrink-0">/</span>
        <span className="text-sm font-medium text-white truncate">{room.name}</span>
        <span className="text-xs text-gray-500 bg-dark-700 px-2 py-0.5 rounded shrink-0">
          {LANG_LABELS[room.language] ?? room.language}
        </span>
        <div className="flex-1" />
        <span className="text-xs bg-amber-900/50 text-amber-300 border border-amber-700/40 px-2.5 py-1 rounded-full shrink-0">
          Read only
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden" ref={containerRef} />
    </div>
  );
}
