import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EllipsisVertical, ChevronRight, ChevronDown, Folder as FolderIcon,
  FolderOpen, Database, Plus, Pencil, Trash2, FolderPlus, LayoutGrid,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useModelerStore, buildProjectTree } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { FolderNode } from '@/store/useModelerStore';
import type { Folder, Project, SubjectArea } from '../services/modeler.service';

/* ──────────────────────────────────────────────────────────────────────────
   Model Explorer — árbol jerárquico Projects → Folders (anidadas) → Canvas.
   Cada nodo muestra al hover un botón "3 puntos" que abre un menú contextual:
     · project: New folder · New canvas · Rename · Delete
     · folder:  New folder · New canvas · Rename · Delete
     · canvas:  Rename · Delete
   Crear/renombrar = input inline. Borrar = ConfirmDialog. Carpetas con chevron.

   Navegación tipo file-tree: expandir/colapsar proyectos y carpetas es SÓLO
   navegación (varios proyectos abiertos a la vez, árboles lazy-load al cache
   `trees` del store) y NO toca el canvas abierto — el canvas sólo cambia al
   clicar OTRO canvas (con spinner mientras carga el diagrama).
   ────────────────────────────────────────────────────────────────────────── */

const INDENT = 14;            // px por nivel de profundidad
const PAD_BASE = 6;           // padding-left base del primer nivel

type NodeKind = 'project' | 'folder' | 'canvas';
interface MenuState { kind: NodeKind; id: string; projectId: string; x: number; y: number; }
// `create` = input transitorio para crear (folder/canvas) dentro de un padre.
interface CreateState { type: 'folder' | 'canvas'; projectId: string; parentFolderId: string | null; }
interface DeleteState { kind: NodeKind; id: string; name: string; projectId: string; }

export default function ModelExplorer({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const projects = useModelerStore((s) => s.projects);
  const trees = useModelerStore((s) => s.trees);
  const activeProjectId = useModelerStore((s) => s.activeProjectId);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const openingSaId = useModelerStore((s) => s.openingSaId);
  const loadProjectTree = useModelerStore((s) => s.loadProjectTree);
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
  // En modo visor el explorer es SOLO navegación: su CRUD (projects/folders/
  // canvases) son escrituras REST directas no versionadas que no pasan por el
  // choke-point del changeset — se ocultan las affordances de mutación.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // ids de folders colapsadas (default: abiertas)
  const [expandedP, setExpandedP] = useState<Set<string>>(new Set()); // ids de proyectos expandidos (default: cerrados)
  const [loadingTrees, setLoadingTrees] = useState<Set<string>>(new Set()); // proyectos con árbol cargando
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<{ kind: NodeKind; id: string; projectId: string } | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [toDelete, setToDelete] = useState<DeleteState | null>(null);

  const isCollapsed = (id: string) => collapsed.has(id);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expand = (id: string) => setCollapsed((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });

  // Expande un proyecto y lazy-carga su árbol al cache si aún no está.
  const ensureProjectOpen = useCallback((pid: string) => {
    setExpandedP((s) => (s.has(pid) ? s : new Set(s).add(pid)));
    if (!useModelerStore.getState().trees[pid]) {
      setLoadingTrees((s) => new Set(s).add(pid));
      loadProjectTree(pid)
        .catch(() => pushToast('No se pudo cargar el proyecto', 'err'))
        .finally(() => setLoadingTrees((s) => { const n = new Set(s); n.delete(pid); return n; }));
    }
  }, [loadProjectTree, pushToast]);
  const toggleProject = (pid: string) => {
    if (expandedP.has(pid)) setExpandedP((s) => { const n = new Set(s); n.delete(pid); return n; });
    else ensureProjectOpen(pid);
  };

  // El proyecto del canvas abierto queda expandido (aditivo: no colapsa otros).
  useEffect(() => { if (activeProjectId) ensureProjectOpen(activeProjectId); }, [activeProjectId, ensureProjectOpen]);

  // Cerrar el menú contextual al clicar fuera o con Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  const openMenu = (kind: NodeKind, id: string, projectId: string, e: React.MouseEvent) => {
    if (readonly) return; // visor: sin menú contextual (rename/delete/create)
    e.preventDefault(); e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, id, projectId, x: r.right, y: r.bottom + 2 });
  };

  // ── Acciones del menú ──────────────────────────────────────────────────
  const startRename = (kind: NodeKind, id: string, projectId: string) => { setMenu(null); setCreating(null); setEditing({ kind, id, projectId }); };
  const startCreate = (type: 'folder' | 'canvas', projectId: string, parentFolderId: string | null) => {
    setMenu(null); setEditing(null);
    ensureProjectOpen(projectId);
    if (parentFolderId) expand(parentFolderId);
    setCreating({ type, projectId, parentFolderId });
  };
  const askDelete = (kind: NodeKind, id: string, name: string, projectId: string) => { setMenu(null); setToDelete({ kind, id, name, projectId }); };

  const commitRename = useCallback(async (kind: NodeKind, id: string, projectId: string, value: string) => {
    setEditing(null);
    const name = value.trim();
    if (!name) return;
    try {
      if (kind === 'project') await renameProject(id, name);
      else if (kind === 'folder') await renameFolder(id, name, projectId);
      else await renameCanvas(id, name, projectId);
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

  // El diálogo queda abierto y bloqueado (busy) hasta que el borrado termina —
  // así se ve que la acción está en proceso en vez de "no pasó nada".
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useCallback(async () => {
    const d = toDelete;
    if (!d) return;
    setDeleting(true);
    try {
      if (d.kind === 'project') await deleteProject(d.id);
      else if (d.kind === 'folder') await deleteFolder(d.id, d.projectId);
      else await deleteCanvas(d.id, d.projectId);
    } catch { pushToast('No se pudo eliminar', 'err'); }
    finally { setDeleting(false); setToDelete(null); }
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

  const renderCanvas = (sa: SubjectArea, depth: number, projectId: string) => {
    if (editing?.kind === 'canvas' && editing.id === sa.id) {
      return <InlineInput key={sa.id} depth={depth} defaultValue={sa.name} leading={<LayoutGrid size={14} />}
        onCommit={(v) => commitRename('canvas', sa.id, projectId, v)} onCancel={() => setEditing(null)} />;
    }
    const opening = openingSaId === sa.id;
    return (
      <Row key={sa.id} depth={depth} active={sa.id === activeSaId} kind="canvas"
        icon={opening ? <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden /> : <LayoutGrid size={14} />}
        label={sa.name}
        onClick={() => {
          // Abrir sólo si no es el canvas ya abierto y no hay otra apertura en vuelo.
          if (sa.id === activeSaId || openingSaId) return;
          selectSubjectArea(sa.id, projectId).catch(() => pushToast('No se pudo abrir el canvas', 'err'));
        }}
        onMenu={readonly ? undefined : (e) => openMenu('canvas', sa.id, projectId, e)} />
    );
  };

  const renderFolder = (node: FolderNode, depth: number, projectId: string) => {
    const { folder } = node;
    const open = !isCollapsed(folder.id);
    const childCount = node.folders.length + node.canvases.length;
    return (
      <div key={folder.id}>
        {editing?.kind === 'folder' && editing.id === folder.id ? (
          <InlineInput depth={depth} defaultValue={folder.name} leading={<FolderIcon size={14} />}
            onCommit={(v) => commitRename('folder', folder.id, projectId, v)} onCancel={() => setEditing(null)} />
        ) : (
          <Row depth={depth} kind="folder"
            chevron={childCount > 0 ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span style={{ width: 13 }} />}
            icon={open ? <FolderOpen size={14} /> : <FolderIcon size={14} />} label={folder.name}
            onClick={() => toggle(folder.id)} onMenu={readonly ? undefined : (e) => openMenu('folder', folder.id, projectId, e)} />
        )}
        {open && (
          <>
            {node.folders.map((f) => renderFolder(f, depth + 1, projectId))}
            {node.canvases.map((c) => renderCanvas(c, depth + 1, projectId))}
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
    // Expandir/colapsar es SÓLO navegación: nunca cambia el canvas abierto.
    const open = expandedP.has(p.id);
    const cached = trees[p.id];
    const tree = open && cached ? buildProjectTree(p, cached.folders, cached.subjectAreas) : null;
    const loadingTree = loadingTrees.has(p.id);
    return (
      <div key={p.id}>
        {editing?.kind === 'project' && editing.id === p.id ? (
          <InlineInput depth={0} defaultValue={p.name} leading={<Database size={14} />}
            onCommit={(v) => commitRename('project', p.id, p.id, v)} onCancel={() => setEditing(null)} />
        ) : (
          <Row depth={0} kind="project" strong active={false}
            chevron={open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            icon={<Database size={14} />} label={p.name}
            onClick={() => toggleProject(p.id)}
            onMenu={readonly ? undefined : (e) => openMenu('project', p.id, p.id, e)} />
        )}
        {open && loadingTree && !cached && (
          <div className="wk-exp-empty" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: PAD_BASE + INDENT + 13 }}>
            <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden /> Cargando…
          </div>
        )}
        {open && tree && (
          <>
            {tree.folders.map((f) => renderFolder(f, 1, p.id))}
            {tree.canvases.map((c) => renderCanvas(c, 1, p.id))}
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
        {!readonly && <button className="wk-exp-headbtn" title="New project" onClick={onNewProject}><Plus size={13} /></button>}
      </div>

      {creating?.projectId === '__new_project__' &&
        <InlineInput depth={0} placeholder="Nombre del Project" leading={<Database size={14} />}
          onCommit={commitNewProject} onCancel={() => setCreating(null)} />}

      {projects.map(renderProject)}

      {projects.length === 0 && !creating &&
        <div className="wk-exp-empty" style={{ padding: 8 }}>Sin proyectos. Creá uno con +.</div>}

      {menu && (
        <ContextMenu menu={menu}
          onNewFolder={() => startCreate('folder', menu.projectId, menu.kind === 'folder' ? menu.id : null)}
          onNewCanvas={() => startCreate('canvas', menu.projectId, menu.kind === 'folder' ? menu.id : null)}
          onRename={() => startRename(menu.kind, menu.id, menu.projectId)}
          onDelete={() => askDelete(menu.kind, menu.id, nameOf(menu, trees, projects), menu.projectId)} />
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
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => { if (!deleting) setToDelete(null); }}
        />
      )}
    </div>
  );
}

// Busca el nombre del nodo del menú para el diálogo de borrado (en el cache
// del árbol de SU proyecto — las listas planas alcanzan, sin recorrer nodos).
function nameOf(
  menu: MenuState,
  trees: Record<string, { folders: Folder[]; subjectAreas: SubjectArea[] }>,
  projects: Project[],
): string {
  if (menu.kind === 'project') return projects.find((p) => p.id === menu.id)?.name ?? '';
  const cached = trees[menu.projectId];
  if (!cached) return '';
  if (menu.kind === 'canvas') return cached.subjectAreas.find((c) => c.id === menu.id)?.name ?? '';
  return cached.folders.find((f) => f.id === menu.id)?.name ?? '';
}

// ── Fila de árbol genérica ───────────────────────────────────────────────
function Row({
  depth, active, strong, kind, chevron, icon, label, onClick, onMenu,
}: {
  depth: number; active?: boolean; strong?: boolean; kind: NodeKind;
  chevron?: React.ReactNode; icon: React.ReactNode; label: string;
  onClick: () => void; onMenu?: (e: React.MouseEvent) => void;
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
      {onMenu && <button className="wk-exp-dots" title="Opciones" onClick={onMenu}><EllipsisVertical size={15} /></button>}
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
