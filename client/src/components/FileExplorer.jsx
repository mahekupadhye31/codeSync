import { useMemo, useState, useRef, useEffect } from 'react';

function buildTree(files) {
  const root = { name: '', path: '', isDir: true, id: null, children: new Map() };
  for (const f of files) {
    if (!f.path) continue;
    const parts = f.path.split('/').filter(Boolean);
    let node = root;
    let cur = '';
    parts.forEach((part, i) => {
      cur = cur ? `${cur}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: cur, isDir: isLast ? f.is_dir : true, id: isLast ? f.id : null, children: new Map() });
      }
      const child = node.children.get(part);
      if (isLast) { child.id = f.id; child.isDir = f.is_dir; }
      node = child;
    });
  }
  return root;
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const IconChevron = ({ open }) => (
  <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);
const IconNewFile = (props) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);
const IconNewFolder = (props) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m-3-3h6m-9 8h12a2 2 0 002-2V8a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const IconRename = (props) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);
const IconTrash = (props) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
  </svg>
);

function InlineInput({ defaultValue = '', placeholder, onCommit, onCancel }) {
  const ref       = useRef(null);
  const doneRef   = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    if (defaultValue) ref.current?.select();
  }, [defaultValue]);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const val = ref.current?.value?.trim() ?? '';
    if (val) onCommit(val);
    else onCancel();
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="w-full bg-dark-700 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white outline-none min-w-0"
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        e.stopPropagation();
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function Node({
  node, depth, activeFileId, collapsed, toggle,
  onSelect, onNewFile, onNewFolder, onRename, onDelete,
  renamingId, onRenameCommit, onRenameCancel,
  creating, onCreateCommit, onCreateCancel,
}) {
  const isOpen   = !collapsed.has(node.path);
  const isActive = node.id && node.id === activeFileId;
  const isRenaming = node.id && node.id === renamingId;
  const pad = { paddingLeft: `${depth * 12 + 8}px` };
  const btn = 'text-gray-500 hover:text-white';

  // Is there a pending create directly inside this folder?
  const childCreate = node.isDir && isOpen && creating?.parentPath === node.path ? creating : null;

  return (
    <div>
      <div
        data-file-path={node.path}
        data-is-dir={node.isDir ? '1' : '0'}
        className={`group flex items-center gap-1 pr-2 py-1 text-xs cursor-pointer rounded ${
          isActive ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300 hover:bg-dark-700'
        }`}
        style={pad}
        onClick={() => (node.isDir ? toggle(node.path) : onSelect(node.id))}
      >
        {node.isDir ? <IconChevron open={isOpen} /> : <span className="w-3 shrink-0" />}

        {isRenaming ? (
          <InlineInput
            defaultValue={node.name}
            placeholder="New name…"
            onCommit={(val) => onRenameCommit(node, val)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="truncate flex-1">{node.name}</span>
        )}

        {!isRenaming && (
          <span className="hidden group-hover:flex items-center gap-1.5 shrink-0">
            {node.isDir && (
              <>
                <button onClick={(e) => { e.stopPropagation(); onNewFile(node); }} title="New file" className={btn}><IconNewFile className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); onNewFolder(node); }} title="New folder" className={btn}><IconNewFolder className="w-3.5 h-3.5" /></button>
              </>
            )}
            <button onClick={(e) => { e.stopPropagation(); onRename(node); }} title="Rename" className={btn}><IconRename className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node); }} title="Delete" className="text-gray-500 hover:text-red-400"><IconTrash className="w-3 h-3" /></button>
          </span>
        )}
      </div>

      {node.isDir && isOpen && (
        <>
          {sortedChildren(node).map((child) => (
            <Node
              key={child.path} node={child} depth={depth + 1}
              activeFileId={activeFileId} collapsed={collapsed} toggle={toggle}
              onSelect={onSelect} onNewFile={onNewFile} onNewFolder={onNewFolder}
              onRename={onRename} onDelete={onDelete}
              renamingId={renamingId} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel}
              creating={creating} onCreateCommit={onCreateCommit} onCreateCancel={onCreateCancel}
            />
          ))}

          {childCreate && (
            <div className="flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              <span className="w-3 shrink-0" />
              <InlineInput
                placeholder={childCreate.isDir ? 'Folder name…' : 'File name…'}
                onCommit={onCreateCommit}
                onCancel={onCreateCancel}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function FileExplorer({ files, activeFileId, onSelect, onCreate, onRename, onDelete }) {
  const [collapsed,   setCollapsed]   = useState(() => new Set());
  const [creating,    setCreating]    = useState(null); // { parentPath, isDir }
  const [renamingId,  setRenamingId]  = useState(null);
  const tree = useMemo(() => buildTree(files), [files]);

  const toggle = (path) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });
  const expand = (path) => {
    if (path) setCollapsed((prev) => { const n = new Set(prev); n.delete(path); return n; });
  };

  const startCreate = (parentPath, isDir) => {
    setCreating({ parentPath, isDir });
    setRenamingId(null);
    expand(parentPath);
  };

  const commitCreate = (name) => {
    if (!creating) return;
    const path = creating.parentPath ? `${creating.parentPath}/${name}` : name;
    onCreate(path, creating.isDir);
    setCreating(null);
  };

  const cancelCreate = () => setCreating(null);

  const startRename = (node) => {
    setRenamingId(node.id);
    setCreating(null);
  };

  const commitRename = (node, newName) => {
    const parts = node.path.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    if (newPath !== node.path) onRename(node.id, newPath);
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

  const deleteNode = (node) => {
    const what = node.isDir ? 'folder and all its contents' : 'file';
    if (window.confirm(`Delete this ${what}?\n"${node.path}"`)) onDelete(node.id);
  };

  const roots = sortedChildren(tree);
  const rootCreate = creating?.parentPath === '' ? creating : null;

  const sharedNodeProps = {
    collapsed, toggle, activeFileId,
    onSelect,
    onNewFile:    (node) => startCreate(node.path, false),
    onNewFolder:  (node) => startCreate(node.path, true),
    onRename:     startRename,
    onDelete:     deleteNode,
    renamingId,
    onRenameCommit: commitRename,
    onRenameCancel: cancelRename,
    creating,
    onCreateCommit: commitCreate,
    onCreateCancel: cancelCreate,
  };

  return (
    <div className="w-56 border-r border-dark-600 bg-dark-800 flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-1">
          <button onClick={() => startCreate('', false)} title="New file" className="text-gray-500 hover:text-white p-0.5"><IconNewFile className="w-4 h-4" /></button>
          <button onClick={() => startCreate('', true)} title="New folder" className="text-gray-500 hover:text-white p-0.5"><IconNewFolder className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {/* Inline input for root-level creation */}
        {rootCreate && (
          <div className="flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: '8px' }}>
            <span className="w-3 shrink-0" />
            <InlineInput
              placeholder={rootCreate.isDir ? 'Folder name…' : 'File name…'}
              onCommit={commitCreate}
              onCancel={cancelCreate}
            />
          </div>
        )}

        {roots.length === 0 && !rootCreate ? (
          <p className="text-xs text-gray-600 text-center px-3 py-6 leading-relaxed">
            No files yet.<br />Click the icons above to create one.
          </p>
        ) : (
          roots.map((node) => (
            <Node key={node.path} node={node} depth={0} {...sharedNodeProps} />
          ))
        )}
      </div>
    </div>
  );
}
