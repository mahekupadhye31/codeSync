import { useEffect, useRef } from 'react';
import {
  Annotation,
  Compartment,
  EditorState,
  StateField,
  StateEffect,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  WidgetType,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { javascript } from '@codemirror/lang-javascript';
import { python }     from '@codemirror/lang-python';
import { cpp }        from '@codemirror/lang-cpp';
import { java }       from '@codemirror/lang-java';
import { go }         from '@codemirror/lang-go';
import { oneDark }    from '@codemirror/theme-one-dark';

// ── Language map ─────────────────────────────────────────────────────────────
function getLangExt(language) {
  switch (language) {
    case 'python':     return python();
    case 'cpp':        return cpp();
    case 'java':       return java();
    case 'go':         return go();
    case 'javascript':
    default:           return javascript({ jsx: true });
  }
}

// ── Annotations / Effects ────────────────────────────────────────────────────
const RemoteChange = Annotation.define();

const SetCursorEffect    = StateEffect.define();
const RemoveCursorEffect = StateEffect.define();
const ClearCursorsEffect = StateEffect.define();

// ── Cursor widget ─────────────────────────────────────────────────────────────
class CursorWidget extends WidgetType {
  constructor(username, color) {
    super();
    this.username = username;
    this.color    = color;
  }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'remote-cursor';
    wrap.style.borderLeftColor = this.color;

    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.textContent = this.username;
    label.style.background = this.color;

    wrap.appendChild(label);
    return wrap;
  }

  eq(other) {
    return this.username === other.username && this.color === other.color;
  }

  ignoreEvent() { return true; }
}

// ── Cursor StateField ─────────────────────────────────────────────────────────
const cursorsField = StateField.define({
  create: () => ({ cursors: new Map(), decos: Decoration.none }),

  update(prev, tr) {
    let { cursors, decos } = prev;
    let changed = false;

    for (const effect of tr.effects) {
      if (effect.is(SetCursorEffect)) {
        cursors = new Map(cursors);
        cursors.set(effect.value.userId, effect.value);
        changed = true;
      } else if (effect.is(RemoveCursorEffect)) {
        if (cursors.has(effect.value)) {
          cursors = new Map(cursors);
          cursors.delete(effect.value);
          changed = true;
        }
      } else if (effect.is(ClearCursorsEffect)) {
        if (cursors.size) { cursors = new Map(); changed = true; }
      }
    }

    if (tr.docChanged) {
      const next = new Map();
      for (const [uid, cur] of cursors) {
        next.set(uid, {
          ...cur,
          position: tr.changes.mapPos(cur.position, 1),
        });
      }
      cursors = next;
      changed = true;
    }

    if (!changed) {
      return { cursors, decos: decos.map(tr.changes) };
    }

    const docLen  = tr.state.doc.length;
    const widgets = [];
    for (const [, cur] of cursors) {
      const pos = Math.max(0, Math.min(cur.position, docLen));
      widgets.push(
        Decoration.widget({
          widget: new CursorWidget(cur.username, cur.color),
          side:   1,
        }).range(pos)
      );
    }
    widgets.sort((a, b) => a.from - b.from);

    let newDecos = Decoration.none;
    try { newDecos = Decoration.set(widgets); } catch { /* ignore invalid ranges */ }

    return { cursors, decos: newDecos };
  },

  provide: (f) => EditorView.decorations.from(f, (val) => val.decos),
});

// ── CodeEditor component ──────────────────────────────────────────────────────
export default function CodeEditor({ language, editorRef, onChange, onCursorMove }) {
  const containerRef    = useRef(null);
  const viewRef         = useRef(null);
  const onChangeRef     = useRef(onChange);
  const langCompartment = useRef(new Compartment());
  const firstLangRef    = useRef(true); // skip reconfigure on initial mount
  onChangeRef.current   = onChange;

  // Wire the imperative API into editorRef every render
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = {
      resetContent(content) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes:     { from: 0, to: view.state.doc.length, insert: content },
          annotations: RemoteChange.of(true),
        });
      },

      applyRemoteOp(op) {
        const view = viewRef.current;
        if (!view) return;
        let change;
        if (op.type === 'insert') {
          const pos = Math.min(op.position, view.state.doc.length);
          change = { from: pos, insert: op.content };
        } else if (op.type === 'delete') {
          const from = Math.min(op.position, view.state.doc.length);
          const to   = Math.min(op.position + op.length, view.state.doc.length);
          if (from >= to) return;
          change = { from, to };
        } else {
          return;
        }
        view.dispatch({
          changes:     change,
          annotations: RemoteChange.of(true),
        });
      },

      setCursor(userId, position, username, color) {
        const view = viewRef.current;
        if (!view) return;
        const clamped = Math.max(0, Math.min(position, view.state.doc.length));
        view.dispatch({
          effects: SetCursorEffect.of({ userId, position: clamped, username, color }),
        });
      },

      removeCursor(userId) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: RemoveCursorEffect.of(userId) });
      },

      clearCursors() {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: ClearCursorsEffect.of(true) });
      },

      getContent() {
        return viewRef.current?.state.doc.toString() ?? '';
      },
    };
  });

  // Bootstrap the editor once — language switching uses Compartment
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.transactions.some((tr) => tr.annotation(RemoteChange))) return;

      if (!update.docChanged && update.selectionSet) {
        onCursorMove?.(update.state.selection.main.head);
        return;
      }

      if (!update.docChanged) return;

      const newDoc = update.state.doc.toString();

      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const text = inserted.toString();
        if (toA > fromA && text.length === 0) {
          onChangeRef.current?.(newDoc, { type: 'delete', position: fromA, length: toA - fromA });
        } else if (toA === fromA && text.length > 0) {
          onChangeRef.current?.(newDoc, { type: 'insert', position: fromA, content: text });
        } else {
          onChangeRef.current?.(newDoc, { type: 'delete', position: fromA, length: toA - fromA });
          onChangeRef.current?.(newDoc, { type: 'insert', position: fromA, content: text });
        }
      });

      onCursorMove?.(update.state.selection.main.head);
    });

    const state = EditorState.create({
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        indentUnit.of('  '),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        indentationMarkers(),
        oneDark,
        langCompartment.current.of(getLangExt(language)),
        cursorsField,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        updateListener,
        EditorView.theme({
          '&':            { height: '100%' },
          '.cm-scroller': { overflow: 'auto', height: '100%' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure language via Compartment when the language prop changes
  useEffect(() => {
    if (firstLangRef.current) {
      firstLangRef.current = false;
      return;
    }
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(getLangExt(language)),
    });
  }, [language]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ minHeight: 0 }}
    />
  );
}
