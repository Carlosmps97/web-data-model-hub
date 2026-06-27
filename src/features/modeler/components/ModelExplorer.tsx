import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EllipsisVertical, ChevronRight, ChevronDown, Folder as FolderIcon,
  FolderOpen, Database, Plus, Pencil, Trash2, FolderPlus, LayoutGrid,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useModelerStore, buildProjectTree } from '@/store/useModelerStore';
import type { FolderNode, ProjectTree } from '@/store/useModelerStore';
import type { Project, SubjectArea } from '../services/modeler.service';

/* ──────────────────────────────────────────────────────────────────────────
   Model Explorer — árbol jerárquico Projects → Folders (anidadas) → Canvas.
   Cada nodo muestra al hover un botón "3 puntos" que abre un menú contextual:
     · project: New folder · New canvas · Rename · Delete
     · folder:  New folder · New canvas · Rename · Delete
     · canvas:  Rename · Delete
   Crear/renombrar = input inline. Borrar = ConfirmDialog. Carpetas con chevron.
   El store sólo tiene cargados folders/canvases del proyecto ACTIVO, por eso
   sólo ese proyecto se expande; clicar otro lo selecciona (carga su árbol).
   ────────────────────────────────────────────────────────────────────────── */

const INDENT = 14;            // px por nivel de profundidad
const PAD_BASE = 6;           // padding-left base del primer nivel

type NodeKind = 'project' | 'folder' | 'canvas';
interface MenuState { kind: NodeKind; id: string; x: number; y: number; }
// `create` = input transitorio para crear (folder/canvas) dentro de un padre.
interface CreateState { type: 'folder' | 'canvas'; projectId: string; parentFolderId: string | null; }
interface DeleteState { kind: NodeKind; id: string; name: string; }

export default function ModelExplorer({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const projects = useModelerStore((s) => s.projects);
  const folders = useModelerStore((s) => s.folders);
  const subjectAreas = useModelerStore((s) => s.subjectAreas);
  const activeProjectId = useModelerStore((s) => s.activeProjectId);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const selectProject = useModelerStore((s) => s.selectProject);
  const selectSubjectArea = useModelerStore((s) => s.selectSubjectArea);
  const createProject = useModelerStore((s) => s.createProject);
  const renameProject = useModelerStore((s) => s.renameProject);
  const deleteProject = useModelerStore((s) => s.deleteProject);
  const createFolder = useModelerStore((s) => s.createFolder);
  const renameFolder = useModelerStore((s) => s.renameFolder);
  const deleteFolder = useModelerStore((s) => s.deleteFolder);
  const createCanvas = useModelerStore((s) => s.createCanvas);
  const renameCanvas = useModelerStore((s) => s.renameCanvas);
  const deleteCanvas = useModelerStore((s) => s.deleteCanvas);

  // Árbol del proyecto activo (folders/canvases del store son sólo del activo).
  const activeTree = useMemo<ProjectTree | null>(() => {
    const p = projects.find((x) => x.id === activeProjectId);
    return p ? buildProjectTree(p, folders, subjectAreas) : null;
  }, [projects, folders, subjectAreas, activeProjectId]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // ids de folders/projects colapsados
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<{ kind: NodeKind; id: string } | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [toDelete, setToDelete] = useState<DeleteState | null>(null);

  const isCollapsed = (id: string) => collapsed.has(id);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expand = (id: string) => setCollapsed((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });

  // Cerrar el menú contextual al clicar fuera o con Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  const openMenu = (kind: NodeKind, id: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, id, x: r.right, y: r.bottom + 2 });
  };

  // ── Acciones del menú ──────────────────────────────────────────────────
  const startRename = (kind: NodeKind, id: string) => { setMenu(null); setCreating(null); setEditing({ kind, id }); };
  const startCreate = (type: 'folder' | 'canvas', projectId: string, parentFolderId: string | null) => {
    setMenu(null); setEditing(null);
    if (parentFolderId) expand(parentFolderId); else expand(projectId);
    setCreating({ type, projectId, parentFolderId });
  };
  const askDelete = (kind: NodeKind, id: string, name: string) => { setMenu(null); setToDelete({ kind, id, name }); };

  const commitRename = useCallback(async (kind: NodeKind, id: string, value: string) => {
    setEditing(null);
    const name = value.trim();
    if (!name) return;
    try {
      if (kind === 'project') await renameProject(id, name);
      else if (kind === 'folder') await renameFolder(id, name);
      else await renameCanvas(id, name);
    } catch { pushToast('No se pudo renombrar', 'err'); }
  }, [renameProject, renameFolder, renameCanvas, pushToast]);

  const commitCreate = useCallback(async (value: string) => {
    const c = creating; setCreating(null);
    if (!c) return;
    const name = value.trim();
    if (!name) return;
    try {
      if (c.type === 'folder') await createFolder(c.projectId, c.parentFolderId, name);
      else await createCanvas(c.projectId, c.parentFolderId, name);
    } catch { pushToast(c.type === 'folder' ? 'No se pudo crear la carpeta' : 'No se pudo crear el canvas', 'err'); }
  }, [creating, createFolder, createCanvas, pushToast]);

  const confirmDelete = useCallback(async () => {
    const d = toDelete; setToDelete(null);
    if (!d) return;
    try {
      if (d.kind === 'project') await deleteProject(d.id);
      else if (d.kind === 'folder') await deleteFolder(d.id);
      else await deleteCanvas(d.id);
    } catch { pushToast('No se pudo eliminar', 'err'); }
  }, [toDelete, deleteProject, deleteFolder, deleteCanvas, pushToast]);

  const onNewProject = () => { setMenu(null); setEditing(null); setCreating({ type: 'folder', projectId: '__new_project__', parentFolderId: null }); };
  const commitNewProject = useCallback(async (value: string) => {
    setCreating(null);
    const name = value.trim();
    if (!name) return;
    try { await createProject(name); } catch { pushToast('No se pudo crear el Project', 'err'); }
  }, [createProject, pushToast]);

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderCreateInput = (depth: number, onCommit: (v: string) => void, placeholder: string, leading: React.ReactNode) => (
    <InlineInput depth={depth} placeholder={placeholder} leading={leading} onCommit={onCommit} onCancel={() => setCreating(null)} />
  );

  const renderCanvas = (sa: SubjectArea, depth: number) => {
    if (editing?.kind === 'canvas' && editing.id === sa.id) {
      return <InlineInput key={sa.id} depth={depth} defaultValue={sa.name} leading={<LayoutGrid size={14} />}
        onCommit={(v) => commitRename('canvas', sa.id, v)} onCancel={() => setEditing(null)} />;
    }
    return (
      <Row key={sa.id} depth={depth} active={sa.id === activeSaId} kind="canvas"
        icon={<LayoutGrid size={14} />} label={sa.name}
        onClick={() => selectSubjectArea(sa.id).catch(() => pushToast('No se pudo abrir el canvas', 'err'))}
        onMenu={(e) => openMenu('canvas', sa.id, e)} />
    );
  };

  const renderFolder = (node: FolderNode, depth: number) => {
    const { folder } = node;
    const open = !isCollapsed(folder.id);
    const childCount = node.folders.length + node.canvases.length;
    return (
      <div key={folder.id}>
        {editing?.kind === 'folder' && editing.id === folder.id ? (
          <InlineInput depth={depth} defaultValue={folder.name} leading={<FolderIcon size={14} />}
            onCommit={(v) => commitRename('folder', folder.id, v)} onCancel={() => setEditing(null)} />
        ) : (
          <Row depth={depth} kind="folder"
            chevron={childCount > 0 ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span style={{ width: 13 }} />}
            icon={open ? <FolderOpen size={14} /> : <FolderIcon size={14} />} label={folder.name}
            onClick={() => toggle(folder.id)} onMenu={(e) => openMenu('folder', folder.id, e)} />
        )}
        {open && (
          <>
            {node.folders.map((f) => renderFolder(f, depth + 1))}
            {node.canvases.map((c) => renderCanvas(c, depth + 1))}
            {creating && creating.parentFolderId === folder.id &&
              renderCreateInput(depth + 1, commitCreate,
                creating.type === 'folder' ? 'Nombre de la carpeta' : 'Nombre del canvas',
                creating.type === 'folder' ? <FolderIcon size={14} /> : <LayoutGrid size={14} />)}
          </>
        )}
      </div>
    );
  };

  const renderProject = (p: Project) => {
    const isActive = p.id === activeProjectId;
    const open = isActive && !isCollapsed(p.id);
    const tree = isActive ? activeTree : null;
    return (
      <div key={p.id}>
        {editing?.kind === 'project' && editing.id === p.id ? (
          <InlineInput depth={0} defaultValue={p.name} leading={<Database size={14} />}
            onCommit={(v) => commitRename('project', p.id, v)} onCancel={() => setEditing(null)} />
        ) : (
          <Row depth={0} kind="project" strong active={false}
            chevron={isActive ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span style={{ width: 13 }} />}
            icon={<Database size={14} />} label={p.name}
            onClick={() => { if (isActive) toggle(p.id); else selectProject(p.id).catch(() => pushToast('No se pudo abrir el proyecto', 'err')); }}
            onMenu={(e) => openMenu('project', p.id, e)} />
        )}
        {open && tree && (
          <>
            {tree.folders.map((f) => renderFolder(f, 1))}
            {tree.canvases.map((c) => renderCanvas(c, 1))}
            {creating && creating.projectId === p.id && creating.parentFolderId === null &&
              renderCreateInput(1, commitCreate,
                creating.type === 'folder' ? 'Nombre de la carpeta' : 'Nombre del canvas',
                creating.type === 'folder' ? <FolderIcon size={14} /> : <LayoutGrid size={14} />)}
            {tree.folders.length === 0 && tree.canvases.length === 0 && !(creating && creating.projectId === p.id) && (
              <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + INDENT + 13 }}>Vacío</div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="wk-explorer">
      <div className="wk-exp-head">
        <span>Model Explorer</span>
        <button className="wk-exp-headbtn" title="New project" onClick={onNewProject}><Plus size={13} /></button>
      </div>

      {creating?.projectId === '__new_project__' &&
        <InlineInput depth={0} placeholder="Nombre del Project" leading={<Database size={14} />}
          onCommit={commitNewProject} onCancel={() => setCreating(null)} />}

      {projects.map(renderProject)}

      {projects.length === 0 && !creating &&
        <div className="wk-exp-empty" style={{ padding: 8 }}>Sin proyectos. Creá uno con +.</div>}

      {menu && (
        <ContextMenu menu={menu}
          onNewFolder={() => startCreate('folder', menu.kind === 'project' ? menu.id : (activeProjectId ?? ''), menu.kind === 'folder' ? menu.id : null)}
          onNewCanvas={() => startCreate('canvas', menu.kind === 'project' ? menu.id : (activeProjectId ?? ''), menu.kind === 'folder' ? menu.id : null)}
          onRename={() => startRename(menu.kind, menu.id)}
          onDelete={() => askDelete(menu.kind, menu.id, nameOf(menu, activeTree, projects))} />
      )}

      {toDelete && (
        <ConfirmDialog
          open
          variant="danger"
          title={`Eliminar ${toDelete.kind === 'project' ? 'proyecto' : toDelete.kind === 'folder' ? 'carpeta' : 'canvas'}`}
          confirmLabel="Eliminar"
          message={
            toDelete.kind === 'folder'
              ? <>Se eliminará la carpeta <strong>{toDelete.name}</strong> y todas sus subcarpetas. Los canvases que contenga se moverán a la raíz del proyecto.</>
              : toDelete.kind === 'project'
                ? <>Se eliminará el proyecto <strong>{toDelete.name}</strong> con todas sus carpetas y canvases. Esta acción no se puede deshacer.</>
                : <>Se eliminará el canvas <strong>{toDelete.name}</strong>. Esta acción no se puede deshacer.</>
          }
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

// Busca el nombre del nodo del menú para el diálogo de borrado.
function nameOf(menu: MenuState, tree: ProjectTree | null, projects: Project[]): string {
  if (menu.kind === 'project') return projects.find((p) => p.id === menu.id)?.name ?? '';
  if (!tree) return '';
  if (menu.kind === 'canvas') {
    const find = (nodes: FolderNode[], rootC: SubjectArea[]): string | undefined => {
      const hit = rootC.find((c) => c.id === menu.id); if (hit) return hit.name;
      for (const n of nodes) { const r = find(n.folders, n.canvases); if (r) return r; }
      return undefined;
    };
    return find(tree.folders, tree.canvases) ?? '';
  }
  const findF = (nodes: FolderNode[]): string | undefined => {
    for (const n of nodes) { if (n.folder.id === menu.id) return n.folder.name; const r = findF(n.folders); if (r) return r; }
    return undefined;
  };
  return findF(tree.folders) ?? '';
}

// ── Fila de árbol genérica ───────────────────────────────────────────────
function Row({
  depth, active, strong, kind, chevron, icon, label, onClick, onMenu,
}: {
  depth: number; active?: boolean; strong?: boolean; kind: NodeKind;
  chevron?: React.ReactNode; icon: React.ReactNode; label: string;
  onClick: () => void; onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`wk-exp-row${active ? ' active' : ''}${strong ? ' strong' : ''}`}
      style={{ paddingLeft: PAD_BASE + depth * INDENT }}
      onClick={onClick}
      data-kind={kind}
    >
      {chevron ?? <span style={{ width: 13 }} />}
      <span className="wk-exp-ico">{icon}</span>
      <span className="wk-exp-label">{label}</span>
      <button className="wk-exp-dots" title="Opciones" onClick={onMenu}><EllipsisVertical size={15} /></button>
    </div>
  );
}

// ── Input inline para crear / renombrar ──────────────────────────────────
function InlineInput({
  depth, defaultValue = '', placeholder, leading, onCommit, onCancel,
}: {
  depth: number; defaultValue?: string; placeholder?: string;
  leading: React.ReactNode; onCommit: (v: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const committed = useRef(false);
  useEffect(() => { const t = setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 10); return () => clearTimeout(t); }, []);
  const commit = () => { if (committed.current) return; committed.current = true; onCommit(ref.current?.value ?? ''); };
  return (
    <div className="wk-exp-row wk-exp-edit" style={{ paddingLeft: PAD_BASE + depth * INDENT }}>
      <span style={{ width: 13 }} />
      <span className="wk-exp-ico">{leading}</span>
      <input
        ref={ref}
        className="wk-exp-input"
        defaultValue={defaultValue}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); committed.current = true; onCancel(); }
        }}
        onBlur={commit}
      />
    </div>
  );
}

// ── Menú contextual (popover anclado a la fila) ──────────────────────────
function ContextMenu({
  menu, onNewFolder, onNewCanvas, onRename, onDelete,
}: {
  menu: MenuState;
  onNewFolder: () => void; onNewCanvas: () => void; onRename: () => void; onDelete: () => void;
}) {
  const showCreate = menu.kind === 'project' || menu.kind === 'folder';
  // Mantener el menú dentro del viewport horizontalmente.
  const left = Math.min(menu.x, window.innerWidth - 200);
  return (
    <div
      className="rd-menu wk-exp-menu"
      style={{ position: 'fixed', left, top: menu.y, zIndex: 1000 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {showCreate && <button className="rd-menu-item" onClick={onNewFolder}><FolderPlus size={15} /> New folder</button>}
      {showCreate && <button className="rd-menu-item" onClick={onNewCanvas}><Plus size={15} /> New canvas</button>}
      {showCreate && <div className="rd-menu-sep" />}
      <button className="rd-menu-item" onClick={onRename}><Pencil size={15} /> Rename</button>
      <button className="rd-menu-item danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>
    </div>
  );
}
