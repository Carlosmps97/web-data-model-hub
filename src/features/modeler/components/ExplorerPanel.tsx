import { useState } from 'react';
import { facetNouns } from '@/lib/facets';
import { Database, FolderOpen, PanelLeftClose, RefreshCw, Search, X } from 'lucide-react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useUiStore } from '@/store/useUiStore';
import ModelExplorer from './ModelExplorer';
import ProjectCatalog from './ProjectCatalog';

/**
 * Explorer unificado (doc 71 §1) — UN solo árbol en el sidebar, como Erwin:
 *
 *   ▾ Proyecto
 *      ▸ Models   (sub-proyectos › dominios › canvases — el Model Explorer de siempre, con su menú)
 *      ▸ Tables   (tablas de los canvases del proyecto, por esquema → columnas)
 *      ▸ Views    (vistas de esas tablas, por esquema → columnas de salida)
 *      ▸ Schemas  (esquemas usados por el proyecto, con conteos)
 *
 * Cabecera: filtro «contiene» sobre lo cargado + acceso al buscador profundo
 * (⌘K, doc 70 §11: localizar en el canvas o inspeccionar metadata, doc 72).
 * Reemplaza el par Model Explorer + Database Explorer apilados con split
 * (doc 60); el catálogo global «Database — all schemas» se retiró (doc 72 §2).
 * Doc 75 D8: el explorer es de UN proyecto (el de la sesión); «Switch…»
 * reabre el Open model para cambiar de proyecto o versión.
 */
export default function ExplorerPanel({ pushToast, onOpenModel }: {
  pushToast: (m: string, k?: 'err') => void;
  onOpenModel?: () => void;
}) {
  const [filter, setFilter] = useState('');
  const setSearchOpen = useModelerStore((s) => s.setSearchOpen);
  const refreshExplorer = useModelerStore((s) => s.refreshExplorer);
  const bumpExplorer = useModelerStore((s) => s.bumpExplorer);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // doc 85: Entity/Attribute vs Table/Column
  const openMode = useSessionStore((s) => s.openMode);
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);
  const deletionPending = useModelerStore((s) => s.projectDeletionPending);
  const toggleExplorer = useUiStore((s) => s.toggleExplorer);

  return (
    <div className="wk-explorer" aria-label="Explorer">
      <div className="wk-exp-head">
        <span>Explorer</span>
        <button type="button" className="wk-exp-headbtn" title="Search the model — locate on canvas or inspect metadata (⌘K)"
          disabled={!openMode} onClick={() => setSearchOpen(true)} aria-label="Search the model">
          <Search size={13} />
        </button>
        {/* Doc 88 §2: válvula manual — el árbol, el catálogo y los esquemas se
            recargan; el tiempo real cubre lo que pasa por el canvas activo. */}
        <button type="button" className="wk-exp-headbtn" title="Refresh the explorer — tree, catalog and schemas"
          disabled={!openMode} aria-label="Refresh the explorer"
          onClick={() => { bumpExplorer(); void refreshExplorer().catch(() => pushToast("Couldn't refresh the explorer", 'err')); }}>
          <RefreshCw size={13} />
        </button>
        {/* Doc 92 D7: colapsa el Explorer a un riel (más espacio de canvas). */}
        <button type="button" className="wk-exp-headbtn" title="Hide the Explorer — more room for the canvas"
          aria-label="Hide the Explorer" aria-expanded={true} onClick={toggleExplorer}>
          <PanelLeftClose size={13} />
        </button>
      </div>
      {openMode && (
        <div className="wk-exp-project-head" title={projectName ?? undefined}>
          <Database size={13} aria-hidden />
          <span className="wk-exp-project-name">
            {projectName ?? '…'}
            {deletionPending && <span className="dmh-explorer-delchip">Deletion pending</span>}
          </span>
          {onOpenModel && (
            <button type="button" className="wk-exp-switch" onClick={onOpenModel} title="Open another project or version">
              <FolderOpen size={11} aria-hidden /> Switch…
            </button>
          )}
        </div>
      )}
      <div className="wk-exp-filter">
        <Search size={12} aria-hidden />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter models, ${n.many}, views…`}
          aria-label="Filter the explorer" onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }} />
        {filter && <button type="button" title="Clear filter" onClick={() => setFilter('')}><X size={11} /></button>}
      </div>
      <ModelExplorer
        pushToast={pushToast}
        filter={filter}
        renderCatalog={(p) => <ProjectCatalog key={p.id} project={p} filter={filter} pushToast={pushToast} />}
      />
    </div>
  );
}
