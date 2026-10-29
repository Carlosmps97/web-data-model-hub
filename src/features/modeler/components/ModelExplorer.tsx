import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EllipsisVertical, ChevronRight, ChevronDown, Folder as FolderIcon,
  FolderOpen, Database, Plus, Pencil, Trash2, FolderPlus, LayoutGrid, FileDown, FileText, FolderInput,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useFloating } from '@/components/ui/useFloating';
import { placeNextTo, type RectLike } from '@/lib/floating';
import { failureText, useModelerStore, buildProjectTree } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { FolderNode } from '@/store/useModelerStore';
import { afterRevalidation, isVersionError, reportWriteError } from '../lib/sessionGuard';
import type { Folder, Project, SubjectArea } from '../services/modeler.service';
import { exportNodeHtml, exportNodePdf } from '../exportPackage';
import type { CancelFlag, ExportOutcome, ExportProgress } from '../exportPackage';
import DeleteProjectDialog from './DeleteProjectDialog';
import MoveToDialog from './MoveToDialog';
import { EXPLORER_DRAG_TYPE, moveVerdict, targetLabel, type MoveItem } from '../lib/explorerMove';
import { useAuthStore } from '@/store/useAuthStore';
import { NO_EXPORT_HINT } from '@/lib/permissionHints';

/* ──────────────────────────────────────────────────────────────────────────
   Model Explorer — árbol jerárquico Project → Folders (anidadas) → Canvas.
   Se muestra solo el proyecto de la sesión (crear proyectos va por el Open
   model; renombrar/borrar el proyecto van por la working copy: «Delete
   project…» graba un cambio y quien revisa la versión lo aprueba como crítico).
   Cada nodo muestra al hover un botón "3 puntos" que abre un menú contextual:
     · project: New folder · New canvas · Export HTML · Rename · Delete project…
     · folder:  New folder · New canvas · Export HTML · Move to… · Rename · Delete
     · canvas:  Export HTML · Move to… · Rename · Delete
   En readonly (o con el borrado del proyecto pendiente) el menú muestra solo
   Export HTML/PDF (exportar no muta).
   Crear/renombrar = input inline. Borrar = ConfirmDialog. Carpetas con chevron.
   Canvases y carpetas se mueven arrastrándolos a otra carpeta (o a «Models», la
   raíz del proyecto) o con «Move to…»; las reglas son las de `lib/explorerMove`.

   Navegación tipo file-tree: expandir/colapsar proyectos y carpetas es solo
   navegación (varios proyectos abiertos a la vez, árboles lazy-load al cache
   `trees` del store) y no toca el canvas abierto: el canvas solo cambia al
   clicar otro canvas (con spinner mientras carga el diagrama).
   ────────────────────────────────────────────────────────────────────────── */

const INDENT = 14;            // px por nivel de profundidad
const PAD_BASE = 6;           // padding-left base del primer nivel

type NodeKind = 'project' | 'folder' | 'canvas';
/** Filas del árbol: los nodos del explorer + la rama «Models». */
type RowKind = NodeKind | 'branch';
/** `at`: el borde derecho de la fila / botón que lo abrió (el menú se ubica
 *  con la regla única de flotantes, no con un tope fijo). */
interface MenuState { kind: NodeKind; id: string; projectId: string; at: RectLike; }
// `create` = input transitorio para crear (folder/canvas) dentro de un padre.
interface CreateState { type: 'folder' | 'canvas'; projectId: string; parentFolderId: string | null; }
interface DeleteState { kind: NodeKind; id: string; name: string; projectId: string; }

export default function ModelExplorer({ pushToast, filter = '', renderCatalog }: {
  pushToast: (m: string, k?: 'err') => void;
  /** Filtro «contiene» de la cabecera del Explorer (carpetas/canvases). */
  filter?: string;
  /** Ramas extra por proyecto (Tables · Views · Schemas), debajo de Models. */
  renderCatalog?: (project: Project) => ReactNode;
}) {
  const q = filter.trim().toLowerCase();
  const allProjects = useModelerStore((s) => s.projects);
  const trees = useModelerStore((s) => s.trees);
  const activeProjectId = useModelerStore((s) => s.activeProjectId);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const openingSaId = useModelerStore((s) => s.openingSaId);
  const loadProjectTree = useModelerStore((s) => s.loadProjectTree);
  const selectSubjectArea = useModelerStore((s) => s.selectSubjectArea);
  const renameProject = useModelerStore((s) => s.renameProject);
  const deletionPending = useModelerStore((s) => s.projectDeletionPending);
  const createFolder = useModelerStore((s) => s.createFolder);
  const renameFolder = useModelerStore((s) => s.renameFolder);
  const deleteFolder = useModelerStore((s) => s.deleteFolder);
  const createCanvas = useModelerStore((s) => s.createCanvas);
  const renameCanvas = useModelerStore((s) => s.renameCanvas);
  const deleteCanvas = useModelerStore((s) => s.deleteCanvas);
  const moveFolder = useModelerStore((s) => s.moveFolder);
  const moveCanvas = useModelerStore((s) => s.moveCanvas);
  // En modo visor el explorer es solo navegación: su CRUD (projects/folders/
  // canvases) son escrituras REST directas no versionadas que no pasan por el
  // choke-point del changeset; se ocultan las affordances de mutación. El
  // menú de 3 puntos sí se abre: queda únicamente «Export HTML».
  const readonlyMode = useSessionStore((s) => s.openMode === 'readonly');
  // Con el borrado del proyecto pendiente en el draft, el explorer
  // no ofrece mutaciones (mismo gate que el visor).
  const readonly = readonlyMode || deletionPending;
  // Exportar HTML/PDF exige el permiso `export`.
  const canExport = useAuthStore((s) => s.has('export'));
  // El explorer es del proyecto de la sesión, nunca de todos.
  const projects = useMemo(() => allProjects.filter((p) => p.id === activeProjectId), [allProjects, activeProjectId]);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const [expandedF, setExpandedF] = useState<Set<string>>(new Set()); // ids de folders expandidas (default: todas colapsadas)
  const [expandedP, setExpandedP] = useState<Set<string>>(new Set()); // ids de proyectos expandidos (default: cerrados)
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set()); // rama Models colapsada (default: abierta)
  const toggleModels = (pid: string) => setCollapsedModels((s) => { const n = new Set(s); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });
  const [loadingTrees, setLoadingTrees] = useState<Set<string>>(new Set()); // proyectos con árbol cargando
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<{ kind: NodeKind; id: string; projectId: string } | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [toDelete, setToDelete] = useState<DeleteState | null>(null);
  // «Move to…» abierto sobre un canvas o una carpeta.
  const [moveTo, setMoveTo] = useState<{ item: MoveItem; name: string; projectId: string } | null>(null);
  // Arrastre en curso (el `dataTransfer` no se puede leer durante `dragover`).
  const dragRef = useRef<{ item: MoveItem; projectId: string } | null>(null);
  // Destino resaltado (`proyecto:carpeta`, `proyecto:` = raíz) y la fila recién movida.
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Carpeta cerrada bajo el cursor: se abre si el arrastre se queda encima.
  const hoverRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Export HTML: modal de progreso + flag de cancelación compartido
  // con la orquestación (mutable: la UI lo pone en true, el pool lo lee).
  const [exporting, setExporting] = useState<{ title: string; format: 'html' | 'pdf' } | null>(null);
  const [exportProg, setExportProg] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportOutcome | null>(null);
  const exportCancelRef = useRef<CancelFlag>({ cancelled: false });

  const startExport = useCallback(async (kind: NodeKind, id: string, projectId: string, format: 'html' | 'pdf') => {
    setMenu(null);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const title = kind === 'project' ? project.name : nameOf({ kind, id, projectId }, trees, projects);
    exportCancelRef.current = { cancelled: false };
    setExportResult(null);
    setExportProg(null);
    setExporting({ title: title || 'Export', format });
    try {
      const run = format === 'pdf' ? exportNodePdf : exportNodeHtml;
      const out = await run({
        kind, nodeId: id, projectId, projectName: project.name,
        onProgress: setExportProg, cancel: exportCancelRef.current,
      });
      if (out.cancelled) { setExporting(null); return; }
      if (out.failed.length) { setExportResult(out); return; }   // el modal muestra el resumen
      setExporting(null);
      pushToast('Exported');
    } catch (e) {
      setExporting(null);
      pushToast(e instanceof Error && e.message ? e.message : "Couldn't export", 'err');
    }
  }, [projects, trees, pushToast]);

  const isOpen = (id: string) => expandedF.has(id);
  const toggle = (id: string) => setExpandedF((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expand = (id: string) => setExpandedF((s) => (s.has(id) ? s : new Set(s).add(id)));

  // Expande un proyecto y lazy-carga su árbol al cache si no está cargado.
  const ensureProjectOpen = useCallback((pid: string) => {
    setExpandedP((s) => (s.has(pid) ? s : new Set(s).add(pid)));
    if (!useModelerStore.getState().trees[pid]) {
      setLoadingTrees((s) => new Set(s).add(pid));
      // Si la versión abierta desapareció (transferida o eliminada), el aviso
      // correcto lo da la revalidación de la sesión. La versión se toma al
      // pedir (la sesión puede cerrarse antes de que llegue el error).
      const askedCs = useSessionStore.getState().activeChangesetId;
      loadProjectTree(pid)
        .catch(async (e: unknown) => {
          if (isVersionError(e, askedCs)) {
            await afterRevalidation();
            if (useSessionStore.getState().activeChangesetId !== askedCs) return;   // la revalidación ya avisó
          }
          pushToast("Couldn't load the project", 'err');
        })
        .finally(() => setLoadingTrees((s) => { const n = new Set(s); n.delete(pid); return n; }));
    }
  }, [loadProjectTree, pushToast]);
  const toggleProject = (pid: string) => {
    if (expandedP.has(pid)) setExpandedP((s) => { const n = new Set(s); n.delete(pid); return n; });
    else ensureProjectOpen(pid);
  };

  // El proyecto del canvas abierto queda expandido (aditivo: no colapsa otros).
  useEffect(() => { if (activeProjectId) ensureProjectOpen(activeProjectId); }, [activeProjectId, ensureProjectOpen]);

  // Revela el canvas abierto: expande su cadena de carpetas (con la capa de
  // origen puede estar 2 niveles adentro) y lo trae a la vista. Solo reacciona
  // al cambio de canvas/árbol: colapsar a mano después sigue libre (expandedF
  // no es dependencia).
  const revealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSaId || !activeProjectId) return;
    const tree = trees[activeProjectId];
    if (!tree) return;
    const sa = tree.subjectAreas.find((s) => s.id === activeSaId);
    if (!sa) return;
    const byId = new Map(tree.folders.map((f) => [f.id, f]));
    const path: string[] = [];
    let fid = sa.folderId ?? null;
    while (fid && byId.has(fid) && !path.includes(fid)) {
      path.push(fid);
      fid = byId.get(fid)!.parentFolderId ?? null;
    }
    if (path.length) {
      setExpandedF((s) => {
        if (path.every((id) => s.has(id))) return s;
        const n = new Set(s);
        path.forEach((id) => n.add(id));
        return n;
      });
    }
    if (revealedRef.current !== activeSaId) {
      revealedRef.current = activeSaId;
      requestAnimationFrame(() => {
        document.querySelector(`.wk-exp-row[data-kind="canvas"][data-id="${activeSaId}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [activeSaId, activeProjectId, trees]);

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
    // El menú también abre en readonly (ContextMenu decide qué mostrar ahí:
    // solo «Export HTML»).
    e.preventDefault(); e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, id, projectId, at: { left: r.right, right: r.right, top: r.top, bottom: r.bottom } });
  };

  // ── Mover (arrastrar y soltar, «Move to…») ──────────────────────────────
  const dropKey = (target: string | null, projectId: string) => `${projectId}:${target ?? ''}`;
  const stopHover = () => { if (hoverRef.current) clearTimeout(hoverRef.current.timer); hoverRef.current = null; };
  useEffect(() => () => stopHover(), []);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);

  const startDrag = (e: React.DragEvent, item: MoveItem, projectId: string) => {
    dragRef.current = { item, projectId };
    e.dataTransfer.setData(EXPLORER_DRAG_TYPE, item.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const endDrag = () => { dragRef.current = null; setDropAt(null); stopHover(); };
  /** Solo un arrastre del Explorer, del mismo proyecto y a un destino válido. */
  const canDrop = (e: React.DragEvent, target: string | null, projectId: string): boolean => {
    const d = dragRef.current;
    const tree = trees[projectId];
    return !!d && !!tree && d.projectId === projectId && e.dataTransfer.types.includes(EXPLORER_DRAG_TYPE)
      && moveVerdict(d.item, target, tree.folders, tree.subjectAreas).ok;
  };
  const dragOver = (e: React.DragEvent, target: string | null, projectId: string, closed = false) => {
    if (!canDrop(e, target, projectId)) return;   // sin preventDefault: el navegador muestra «no se puede»
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const key = dropKey(target, projectId);
    if (dropAt !== key) setDropAt(key);
    if (closed && target && hoverRef.current?.id !== target) {
      stopHover();
      hoverRef.current = { id: target, timer: setTimeout(() => { hoverRef.current = null; expand(target); }, 700) };
    }
  };
  const dragLeave = (e: React.DragEvent, target: string | null, projectId: string) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
    if (dropAt === dropKey(target, projectId)) setDropAt(null);
    if (hoverRef.current?.id === target) stopHover();
  };
  const drop = (e: React.DragEvent, target: string | null, projectId: string) => {
    const d = dragRef.current;
    const ok = canDrop(e, target, projectId);
    endDrag();
    if (!d || !ok) return;
    e.preventDefault();
    void doMove(d.item, target, projectId);
  };

  /** Graba el movimiento, abre la carpeta destino y resalta lo movido. true si se movió. */
  const doMove = async (item: MoveItem, target: string | null, projectId: string): Promise<boolean> => {
    const tree = trees[projectId];
    const name = (item.kind === 'folder' ? tree?.folders : tree?.subjectAreas)?.find((x) => x.id === item.id)?.name ?? '';
    const where = targetLabel(target, tree?.folders ?? []);
    const onError = reportWriteError((e) => pushToast(failureText("Couldn't move", e), 'err'));
    try {
      const moved = item.kind === 'folder' ? await moveFolder(item.id, target, projectId) : await moveCanvas(item.id, target, projectId);
      if (!moved) return false;
      // La cadena del destino queda abierta: lo movido se ve donde quedó.
      const byId = new Map((useModelerStore.getState().trees[projectId]?.folders ?? []).map((f) => [f.id, f]));
      const chain: string[] = [];
      for (let fid = target; fid && byId.has(fid) && !chain.includes(fid); fid = byId.get(fid)!.parentFolderId ?? null) chain.push(fid);
      if (chain.length) setExpandedF((cur) => { const n = new Set(cur); chain.forEach((id) => n.add(id)); return n; });
      setFlashId(item.id);
      requestAnimationFrame(() => {
        document.querySelector(`.wk-exp-row[data-kind="${item.kind}"][data-id="${item.id}"]`)?.scrollIntoView({ block: 'nearest' });
      });
      pushToast(`Moved “${name}” to “${where}”`);
      return true;
    } catch (e) { await onError(e); return false; }
  };

  // ── Acciones del menú ──────────────────────────────────────────────────
  const startRename = (kind: NodeKind, id: string, projectId: string) => { setMenu(null); setCreating(null); setEditing({ kind, id, projectId }); };
  const startCreate = (type: 'folder' | 'canvas', projectId: string, parentFolderId: string | null) => {
    setMenu(null); setEditing(null);
    ensureProjectOpen(projectId);
    if (parentFolderId) expand(parentFolderId);
    setCreating({ type, projectId, parentFolderId });
  };
  const askDelete = (kind: NodeKind, id: string, name: string, projectId: string) => {
    setMenu(null);
    if (kind === 'project') {
      // Borrado por draft con confirmación tipeada y conteos.
      const project = projects.find((p) => p.id === id);
      if (project) setProjectToDelete(project);
      return;
    }
    setToDelete({ kind, id, name, projectId });
  };

  const startMoveTo = (kind: NodeKind, id: string, projectId: string) => {
    setMenu(null);
    if (kind === 'project') return;
    setMoveTo({ item: { kind, id }, name: nameOf({ kind, id, projectId }, trees, projects), projectId });
  };

  const commitRename = useCallback(async (kind: NodeKind, id: string, projectId: string, value: string) => {
    setEditing(null);
    const name = value.trim();
    if (!name) return;
    // El fallo espera la revalidación y calla si la sesión es otra (`reportWriteError`).
    const onError = reportWriteError((e) => pushToast(failureText("Couldn't rename", e), 'err'));
    try {
      if (kind === 'project') await renameProject(id, name);
      else if (kind === 'folder') await renameFolder(id, name, projectId);
      else await renameCanvas(id, name, projectId);
    } catch (e) { await onError(e); }
  }, [renameProject, renameFolder, renameCanvas, pushToast]);

  const commitCreate = useCallback(async (value: string) => {
    const c = creating; setCreating(null);
    if (!c) return;
    const name = value.trim();
    if (!name) return;
    const onError = reportWriteError((e) => pushToast(failureText(c.type === 'folder' ? "Couldn't create the folder" : "Couldn't create the canvas", e), 'err'));
    try {
      if (c.type === 'folder') await createFolder(c.projectId, c.parentFolderId, name);
      else await createCanvas(c.projectId, c.parentFolderId, name);
    } catch (e) { await onError(e); }
  }, [creating, createFolder, createCanvas, pushToast]);

  // El diálogo queda abierto y bloqueado (busy) hasta que el borrado termina —
  // así se ve que la acción está en proceso en vez de "no pasó nada".
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useCallback(async () => {
    const d = toDelete;
    if (!d) return;
    setDeleting(true);
    const onError = reportWriteError((e) => pushToast(failureText("Couldn't delete", e), 'err'));
    try {
      if (d.kind === 'folder') await deleteFolder(d.id, d.projectId);
      else await deleteCanvas(d.id, d.projectId);
    } catch (e) { await onError(e); }
    finally { setDeleting(false); setToDelete(null); }
  }, [toDelete, deleteFolder, deleteCanvas, pushToast]);

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderCreateInput = (depth: number, onCommit: (v: string) => void, placeholder: string, leading: React.ReactNode) => (
    <InlineInput depth={depth} placeholder={placeholder} leading={leading} onCommit={onCommit} onCancel={() => setCreating(null)} />
  );

  const renderCanvas = (sa: SubjectArea, depth: number, projectId: string) => {
    if (q && !sa.name.toLowerCase().includes(q) && !(editing?.kind === 'canvas' && editing.id === sa.id)) return null;
    if (editing?.kind === 'canvas' && editing.id === sa.id) {
      return <InlineInput key={sa.id} depth={depth} defaultValue={sa.name} leading={<LayoutGrid size={14} />}
        onCommit={(v) => commitRename('canvas', sa.id, projectId, v)} onCancel={() => setEditing(null)} />;
    }
    const opening = openingSaId === sa.id;
    return (
      <Row key={sa.id} depth={depth} active={sa.id === activeSaId} kind="canvas" dataId={sa.id} flash={flashId === sa.id}
        icon={opening ? <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden /> : <LayoutGrid size={14} />}
        label={sa.name}
        drag={readonly ? undefined : { onDragStart: (e) => startDrag(e, { kind: 'canvas', id: sa.id }, projectId), onDragEnd: endDrag }}
        onClick={() => {
          // Abrir solo si no es el canvas ya abierto y no hay otra apertura en vuelo.
          if (sa.id === activeSaId || openingSaId) return;
          // Espera la revalidación (con la versión recién transferida o eliminada
          // avisa ella, sin un segundo aviso) y dice por qué.
          selectSubjectArea(sa.id, projectId).catch(reportWriteError((e) => pushToast(failureText("Couldn't open the canvas", e), 'err')));
        }}
        onMenu={(e) => openMenu('canvas', sa.id, projectId, e)} />
    );
  };

  const renderFolder = (node: FolderNode, depth: number, projectId: string) => {
    const { folder } = node;
    if (q && !folderHasMatch(node, q)) return null;
    const open = q ? true : isOpen(folder.id);
    const childCount = node.folders.length + node.canvases.length;
    return (
      <div key={folder.id}>
        {editing?.kind === 'folder' && editing.id === folder.id ? (
          <InlineInput depth={depth} defaultValue={folder.name} leading={<FolderIcon size={14} />}
            onCommit={(v) => commitRename('folder', folder.id, projectId, v)} onCancel={() => setEditing(null)} />
        ) : (
          <Row depth={depth} kind="folder" dataId={folder.id} flash={flashId === folder.id}
            dropOk={dropAt === dropKey(folder.id, projectId)}
            chevron={childCount > 0 ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span style={{ width: 13 }} />}
            icon={open ? <FolderOpen size={14} /> : <FolderIcon size={14} />} label={folder.name}
            drag={readonly ? undefined : { onDragStart: (e) => startDrag(e, { kind: 'folder', id: folder.id }, projectId), onDragEnd: endDrag }}
            dropTarget={readonly ? undefined : {
              onDragOver: (e) => dragOver(e, folder.id, projectId, !open),
              onDragLeave: (e) => dragLeave(e, folder.id, projectId),
              onDrop: (e) => drop(e, folder.id, projectId),
            }}
            onClick={() => toggle(folder.id)} onMenu={(e) => openMenu('folder', folder.id, projectId, e)} />
        )}
        {open && (
          <>
            {node.folders.map((f) => renderFolder(f, depth + 1, projectId))}
            {node.canvases.map((c) => renderCanvas(c, depth + 1, projectId))}
            {creating && creating.parentFolderId === folder.id &&
              renderCreateInput(depth + 1, commitCreate,
                creating.type === 'folder' ? 'Folder name' : 'Canvas name',
                creating.type === 'folder' ? <FolderIcon size={14} /> : <LayoutGrid size={14} />)}
          </>
        )}
      </div>
    );
  };

  const renderProject = (p: Project) => {
    // Expandir/colapsar es solo navegación: nunca cambia el canvas abierto.
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
            onMenu={(e) => openMenu('project', p.id, p.id, e)} />
        )}
        {open && loadingTree && !cached && (
          <div className="wk-exp-empty" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: PAD_BASE + INDENT + 13 }}>
            <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden /> Loading…
          </div>
        )}
        {open && tree && (
          <>
            {/* La jerarquía de canvases (sub-proyectos › dominios › modelos)
                vive en la rama «Models»; Tables · Views · Schemas las aporta
                renderCatalog al mismo nivel. */}
            <Row depth={1} kind="branch" active={false} dropOk={dropAt === dropKey(null, p.id)}
              chevron={(q || !collapsedModels.has(p.id)) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              icon={<LayoutGrid size={14} />} label="Models" count={countCanvases(tree)}
              dropTarget={readonly ? undefined : {
                onDragOver: (e) => dragOver(e, null, p.id),
                onDragLeave: (e) => dragLeave(e, null, p.id),
                onDrop: (e) => drop(e, null, p.id),
              }}
              onClick={() => toggleModels(p.id)} />
            {(q || !collapsedModels.has(p.id)) && (
              <>
                {tree.folders.map((f) => renderFolder(f, 2, p.id))}
                {tree.canvases.map((c) => renderCanvas(c, 2, p.id))}
                {creating && creating.projectId === p.id && creating.parentFolderId === null &&
                  renderCreateInput(2, commitCreate,
                    creating.type === 'folder' ? 'Folder name' : 'Canvas name',
                    creating.type === 'folder' ? <FolderIcon size={14} /> : <LayoutGrid size={14} />)}
                {tree.folders.length === 0 && tree.canvases.length === 0 && !(creating && creating.projectId === p.id) && (
                  <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + 2 * INDENT + 13 }}>No models yet</div>
                )}
              </>
            )}
            {renderCatalog?.(p)}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="wk-exp-tree">
      {projects.map(renderProject)}

      {projects.length === 0 && !creating &&
        <div className="wk-exp-empty" style={{ padding: 8 }}>Open a project to browse its models.</div>}

      {menu && (
        <ContextMenu menu={menu} readonly={readonly} canExport={canExport}
          onNewFolder={() => startCreate('folder', menu.projectId, menu.kind === 'folder' ? menu.id : null)}
          onNewCanvas={() => startCreate('canvas', menu.projectId, menu.kind === 'folder' ? menu.id : null)}
          onExport={() => { void startExport(menu.kind, menu.id, menu.projectId, 'html'); }}
          onExportPdf={() => { void startExport(menu.kind, menu.id, menu.projectId, 'pdf'); }}
          onMoveTo={() => startMoveTo(menu.kind, menu.id, menu.projectId)}
          onRename={() => startRename(menu.kind, menu.id, menu.projectId)}
          onDelete={() => askDelete(menu.kind, menu.id, nameOf(menu, trees, projects), menu.projectId)} />
      )}

      {moveTo && trees[moveTo.projectId] && (
        <MoveToDialog item={moveTo.item} name={moveTo.name}
          folders={trees[moveTo.projectId].folders} canvases={trees[moveTo.projectId].subjectAreas}
          onMove={async (target) => { if (await doMove(moveTo.item, target, moveTo.projectId)) setMoveTo(null); }}
          onClose={() => setMoveTo(null)} />
      )}

      {exporting && (
        <ExportModal
          title={exporting.title}
          format={exporting.format}
          prog={exportProg}
          result={exportResult}
          onCancel={() => { exportCancelRef.current.cancelled = true; }}
          onClose={() => setExporting(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          open
          variant="danger"
          title={`Delete ${toDelete.kind === 'folder' ? 'folder' : 'canvas'}`}
          confirmLabel="Delete"
          message={
            toDelete.kind === 'folder'
              ? <>Folder <strong>{toDelete.name}</strong> and all its subfolders will be deleted. Any canvases inside will move to the project root.</>
              : <>Canvas <strong>{toDelete.name}</strong> will be deleted. This action cannot be undone.</>
          }
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => { if (!deleting) setToDelete(null); }}
        />
      )}
      {projectToDelete && (
        <DeleteProjectDialog
          open
          project={projectToDelete}
          onClose={() => setProjectToDelete(null)}
          onDeleted={() => { setProjectToDelete(null); pushToast('Project deletion recorded in your working copy'); }}
        />
      )}
    </div>
  );
}

// Busca el nombre del nodo del menú para el diálogo de borrado (en el cache
// del árbol de su proyecto: las listas planas alcanzan, sin recorrer nodos).
function nameOf(
  menu: Pick<MenuState, 'kind' | 'id' | 'projectId'>,
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
  depth, active, strong, kind, chevron, icon, label, count, onClick, onMenu, dataId, drag, dropTarget, dropOk, flash,
}: {
  depth: number; active?: boolean; strong?: boolean; kind: RowKind;
  chevron?: React.ReactNode; icon: React.ReactNode; label: string;
  /** Contador a la derecha (ramas del proyecto). */
  count?: number;
  onClick: () => void; onMenu?: (e: React.MouseEvent) => void; dataId?: string;
  /** La fila se puede arrastrar (canvas o carpeta, en edición). */
  drag?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
  /** La fila recibe lo que se suelta (carpeta o «Models», en edición). */
  dropTarget?: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  /** Destino válido bajo el arrastre. */
  dropOk?: boolean;
  /** Recién movida: se resalta un momento. */
  flash?: boolean;
}) {
  return (
    <div
      className={`wk-exp-row${active ? ' active' : ''}${strong ? ' strong' : ''}${dropOk ? ' drop-ok' : ''}${flash ? ' flash' : ''}`}
      style={{ paddingLeft: PAD_BASE + depth * INDENT }}
      onClick={onClick}
      data-kind={kind}
      data-id={dataId}
      draggable={drag ? true : undefined}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
      onDragOver={dropTarget?.onDragOver}
      onDragLeave={dropTarget?.onDragLeave}
      onDrop={dropTarget?.onDrop}
    >
      {chevron ?? <span style={{ width: 13 }} />}
      <span className="wk-exp-ico">{icon}</span>
      <span className="wk-exp-label">{label}</span>
      {count != null && <span className="wk-exp-count">{count}</span>}
      {onMenu && <button className="wk-exp-dots" title="Options" onClick={onMenu}><EllipsisVertical size={15} /></button>}
    </div>
  );
}

/** ¿La carpeta (o alguna descendiente / canvas) matchea el filtro? */
function folderHasMatch(node: FolderNode, q: string): boolean {
  if (node.folder.name.toLowerCase().includes(q)) return true;
  if (node.canvases.some((c) => c.name.toLowerCase().includes(q))) return true;
  return node.folders.some((f) => folderHasMatch(f, q));
}

/** Total de canvases de un proyecto (contador de la rama «Models»). */
function countCanvases(tree: { folders: FolderNode[]; canvases: SubjectArea[] }): number {
  const inFolder = (n: FolderNode): number => n.canvases.length + n.folders.reduce((s, f) => s + inFolder(f), 0);
  return tree.canvases.length + tree.folders.reduce((s, f) => s + inFolder(f), 0);
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
  menu, readonly, canExport, onNewFolder, onNewCanvas, onExport, onExportPdf, onMoveTo, onRename, onDelete,
}: {
  menu: MenuState; readonly: boolean;
  canExport: boolean;
  onNewFolder: () => void; onNewCanvas: () => void; onExport: () => void; onExportPdf: () => void;
  onMoveTo: () => void; onRename: () => void; onDelete: () => void;
}) {
  // Readonly: exportar no muta; el menú aparece igual, pero solo
  // con «Export HTML»; crear/renombrar/borrar siguen ocultos en modo visor.
  const showMutations = !readonly;
  const showCreate = showMutations && (menu.kind === 'project' || menu.kind === 'folder');
  // Debajo de la fila (desde su borde derecho); arriba si abajo no entra (en
  // las últimas filas del Explorer se cortaría), corrido para no salirse por la
  // derecha y con scroll si no entra en ningún lado.
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, bounds) => placeNextTo(menu.at, box, bounds, { side: 'bottom', align: 'start', gap: 2 }), [menu]);
  return (
    <div
      ref={ref}
      className="rd-menu wk-exp-menu"
      style={{ ...place, zIndex: 1000 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {showCreate && <button className="rd-menu-item" onClick={onNewFolder}><FolderPlus size={15} /> New folder</button>}
      {showCreate && <button className="rd-menu-item" onClick={onNewCanvas}><Plus size={15} /> New canvas</button>}
      {showCreate && <div className="rd-menu-sep" />}
      {/* Export HTML del nodo (proyecto/folder → ZIP; canvas → .html). */}
      <button className="rd-menu-item" onClick={onExport} disabled={!canExport}
        title={canExport ? undefined : NO_EXPORT_HINT}><FileDown size={15} /> Export HTML</button>
      {/* Un PDF multipágina del nodo (2 páginas por canvas: L+P). */}
      <button className="rd-menu-item" onClick={onExportPdf} disabled={!canExport}
        title={canExport ? undefined : NO_EXPORT_HINT}><FileText size={15} /> Export PDF</button>
      {showMutations && <div className="rd-menu-sep" />}
      {showMutations && menu.kind !== 'project' && <button className="rd-menu-item" onClick={onMoveTo}><FolderInput size={15} /> Move to…</button>}
      {showMutations && <button className="rd-menu-item" onClick={onRename}><Pencil size={15} /> Rename</button>}
      {showMutations && (
        <button className="rd-menu-item danger" onClick={onDelete}>
          <Trash2 size={15} /> {menu.kind === 'project' ? 'Delete project…' : 'Delete'}
        </button>
      )}
    </div>
  );
}

// ── Modal de progreso del export HTML ────────────────────────────────────
// Patrón visual de ConfirmDialog (backdrop --top + dmh-modal). Mientras corre:
// barra determinada + Cancel; si terminó con fallos: resumen + Close.
function ExportModal({
  title, format, prog, result, onCancel, onClose,
}: {
  title: string; format: 'html' | 'pdf'; prog: ExportProgress | null; result: ExportOutcome | null;
  onCancel: () => void; onClose: () => void;
}) {
  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
  const finished = result !== null;
  return (
    <div className="dmh-backdrop dmh-backdrop--top" role="presentation">
      <div className="dmh-modal" style={{ width: 440 }} role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div className="m-body">
          <h3 id="export-modal-title" className="rd-h3" style={{ marginBottom: 10 }}>Export {format === 'pdf' ? 'PDF' : 'HTML'} — {title}</h3>
          {!finished && (
            <>
              <div className="rd-small" style={{ marginBottom: 8 }}>
                {prog ? `Exporting… ${prog.done}/${prog.total}${prog.current ? ` — ${prog.current}` : ''}` : 'Preparing…'}
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--primary-soft, #E3EBFF)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--primary-700, #35507E)', transition: 'width .2s' }} />
              </div>
            </>
          )}
          {finished && result && (
            <div className="rd-small" style={{ lineHeight: 1.6 }}>
              Exported {result.exported}/{result.total}.<br />
              Failed: {result.failed.join(', ')}
            </div>
          )}
        </div>
        <div className="m-foot">
          {!finished && <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onCancel}>Cancel</button>}
          {finished && <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
