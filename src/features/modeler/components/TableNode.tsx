import { memo, useMemo, useState, type DragEvent } from 'react';
import { facetNouns } from '@/lib/facets';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GripVertical, KeyRound, Link2, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { useModelerStore } from '@/store/useModelerStore';
import { reportWriteError } from '../lib/sessionGuard';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import { orderColumns } from '../lib/columnOrder';
import { planCanvasDrop, type DropTarget } from '../lib/canvasDrop';
import { tableLodSize } from '../lib/lodSize';
import { boxHex, tintStyle } from '../lib/boxColor';

export interface TableNodeData {
  table: CanonicalTable;
  columns: CanonicalColumn[];
  /** LOD: render compacto bajo el umbral de zoom. */
  lod?: boolean;
  /** Ids de columnas ancladas por algún wire (par 0 de sus relaciones): el
   *  nodo compacto les deja handles fantasma con el mismo id que la fila del
   *  modo detallado, así los edges nunca se re-arman ni pierden ancla. */
  refCols?: string[];
  [key: string]: unknown;
}

function TableNode({ data }: NodeProps) {
  const { table, columns, lod, refCols } = data as TableNodeData;
  // En modo visor puede haber changeset activo (viendo un request): sin handles
  // conectables ni affordances de edición.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  // Los handles solo conectan con una herramienta de dibujo armada (relación,
  // `relPreset`, o subcategoría); sin armar, el drag desde una columna no crea
  // wires.
  const relArmed = useModelerStore((s) => s.relPreset != null || s.subcatArmed);
  const connectable = canEdit && relArmed;
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  const applyCanvasDrop = useModelerStore((s) => s.applyCanvasDrop);
  // Selector booleano (no el id crudo): con el id, cambiar la selección
  // re-renderizaría todos los nodos del canvas; con el booleano solo los 2
  // afectados (el que se selecciona y el que se deselecciona).
  const selected = useModelerStore((s) => s.selectedTableId === table.id);
  // Columnas a resaltar cuando el wire de una relación está bajo el mouse (o
  // seleccionado): todas las de los pares que tocan esta tabla. El selector
  // devuelve un string estable ('' para las tablas no afectadas) para que el
  // hover solo re-renderice los 2 nodos de la relación, no el canvas entero.
  const hotColsKey = useModelerStore((s) => {
    const relId = s.hoverEdgeId ?? s.selectedEdgeId;
    if (!relId || !s.diagram) return '';
    const rel = s.diagram.relationships.find((r) => r.id === relId);
    if (!rel || (rel.parentTableId !== table.id && rel.childTableId !== table.id)) return '';
    const ids: string[] = [];
    for (const p of rel.pairs) {
      if (rel.parentTableId === table.id && p.parentColumnId) ids.push(p.parentColumnId);
      if (rel.childTableId === table.id && p.childColumnId) ids.push(p.childColumnId);
    }
    return ids.join('|');
  });
  const hotCols = useMemo(() => new Set(hotColsKey ? hotColsKey.split('|') : []), [hotColsKey]);
  // ── Drag&drop de filas (como Erwin): arrastrar reordena las columnas
  // (`ordinal`, el único orden); soltar en el área de llave hace PK; sacar una
  // PK del área la desmarca. Solo en edición, sin LOD y sin herramienta de
  // dibujo. El grip lleva `nodrag`: React Flow no arrastra la tabla desde ahí.
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | 'pkzone' | null>(null);
  const endDrag = () => { setDragId(null); setOver(null); };
  const dropAt = async (target: DropTarget) => {
    const src = dragId; endDrag();
    if (!src) return;
    const plan = planCanvasDrop(columns, src, target);
    if (!plan.order && !plan.key.length) return;
    // El fallo espera la revalidación y calla si la sesión cambia (`reportWriteError`).
    const onError = reportWriteError((e) => toast.error(e instanceof Error && e.message ? e.message : "Couldn't move the column"));
    try { await applyCanvasDrop(table.id, plan); }
    catch (e) { await onError(e); }
  };
  const afterHalf = (e: DragEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  // Selección de columnas para copy/paste. Mismo patrón de clave estable que
  // hotColsKey: '' para las tablas sin selección; un clic solo re-renderiza los
  // nodos afectados, no el canvas entero.
  const selColsKey = useModelerStore((s) => (s.colSel?.tableId === table.id ? s.colSel.ids.join('|') : ''));
  const selCols = useMemo(() => new Set(selColsKey ? selColsKey.split('|') : []), [selColsKey]);
  const toggleColSelect = useModelerStore((s) => s.toggleColSelect);
  const openColMenu = useModelerStore((s) => s.openColMenu);
  const focusColumnInPanel = useModelerStore((s) => s.focusColumnInPanel);
  // Color de la caja en este canvas (excepción del canvas → color de la tabla →
  // sin color). Selector de string: un cambio re-pinta solo esta caja.
  const hex = useModelerStore((s) => boxHex(table.id, table.color, s.canvasColors, s.themeIdx, s.colorPreview));
  const tint = tintStyle(hex);

  const nameOf = (o: { logicalName: string; physicalName: string }) =>
    viewMode === 'logical' ? o.logicalName : o.physicalName;
  // El orden único: bloque PK primero y cada bloque por `ordinal` (sin orden de
  // llave aparte; el mismo del PRIMARY KEY(...) del DDL), igual en ambas facetas.
  const drawn = orderColumns(columns);   // el mismo orden con que `keepMeasured` ve las anclas
  const pks = drawn.filter((c) => !!c.isPrimaryKey);
  const rest = drawn.filter((c) => !c.isPrimaryKey);
  const canDrag = canEdit && !lod && !relArmed;
  const rowDrag = (c: CanonicalColumn) => (!canDrag ? {} : {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragId) return;
      e.preventDefault(); e.stopPropagation();
      setOver(dragId === c.id ? null : { id: c.id, after: afterHalf(e) });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault(); e.stopPropagation();
      void dropAt({ kind: 'row', id: c.id, after: afterHalf(e) });
    },
  });
  const zoneDrag = !canDrag ? {} : {
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!dragId) return; e.preventDefault(); setOver('pkzone'); },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); void dropAt({ kind: 'pkzone' }); },
  };

  // LOD: caja compacta con el mismo tamaño, header y franja PK que el nodo
  // detallado; a este zoom las filas miden <1px, no se pierde nada visible.
  // Handles: el del header (ancla de derivaciones) + fantasmas por columna
  // referenciada por wires (mismo id que la fila real → los edges no cambian
  // entre modos). Sin botón "+" (la edición vuelve al acercar).
  if (lod) {
    const { w, h, pkRows } = tableLodSize(table as CanonicalTable, columns, viewMode);
    return (
      <div className={`wk-node wk-lod${selected ? ' sel' : ''}${hex ? ' tinted' : ''}`} style={{ width: w, height: h, ...tint }}>
        <div className="wk-node-head">
          <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
          <span className="rd-mono wk-node-title">
            {table.schema && <span className="wk-node-schema">{table.schema}.</span>}
            {nameOf(table)}
          </span>
          <Handle type="source" position={Position.Right} id="__hdr_src" isConnectable={false} className="wk-hdr-handle" />
        </div>
        {pkRows > 0 && <div className="wk-node-pk" style={{ height: pkRows * 28 }} />}
        {(refCols ?? []).map((cid) => (
          <span key={cid}>
            <Handle type="source" position={Position.Right} id={`${cid}__src`} isConnectable={false} className="wk-hdr-handle" style={{ top: '50%' }} />
            <Handle type="target" position={Position.Left} id={`${cid}__tgt`} isConnectable={false} className="wk-hdr-handle" style={{ top: '50%' }} />
          </span>
        ))}
      </div>
    );
  }

  const renderRow = (c: CanonicalColumn) => (
    <div
      className={`wk-node-row${hotCols.has(c.id) ? ' hot' : ''}${selCols.has(c.id) ? ' selcol' : ''}${dragId === c.id ? ' dragging' : ''}${over && over !== 'pkzone' && over.id === c.id ? (over.after ? ' dropafter' : ' dropbefore') : ''}`}
      key={c.id}
      {...rowDrag(c)}
      // Clic simple = seleccionar la fila y abrir el Properties de esta
      // columna (sidebar propio); Ctrl/Cmd+clic y Shift+clic solo arman la
      // multi-selección (sin navegar el panel). Con la herramienta de
      // relación armada no hay selección (los gestos no se mezclan).
      // stopPropagation: el onNodeClick del canvas deselecciona filas; aquí
      // la selección de tabla la hace focusColumnInPanel. El clic fantasma
      // tras un drag real del nodo no llega: nodeDragThreshold +
      // clickDistance de React Flow lo suprimen.
      onClick={(e) => {
        if (relArmed) return;
        e.stopPropagation();
        const multi = e.shiftKey || e.metaKey || e.ctrlKey;
        toggleColSelect(table.id, c.id, e.shiftKey ? 'range' : multi ? 'toggle' : 'single');
        if (!multi) focusColumnInPanel(table.id, c.id);
      }}
      onContextMenu={(e) => {
        if (relArmed) return;
        e.preventDefault();
        e.stopPropagation();   // que no dispare también el menú del bloque
        if (!selCols.has(c.id)) toggleColSelect(table.id, c.id, 'single');
        openColMenu({ x: e.clientX, y: e.clientY, tableId: table.id, colId: c.id });
      }}
    >
      {canDrag && (
        <span className="wk-node-grip nodrag" draggable
          title="Drag to reorder · drop in the key area to make it a key column"
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', c.id);
            const row = e.currentTarget.parentElement;
            if (row) e.dataTransfer.setDragImage(row, 12, 12);
            setDragId(c.id);
          }}
          onDragEnd={endDrag}>
          <GripVertical size={10} strokeWidth={2} />
        </span>
      )}
      <span className="wk-node-key" aria-hidden>
        {c.isPrimaryKey ? (
          <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)' }} />
        ) : c.isForeignKey ? (
          <Link2 size={11} strokeWidth={2} style={{ color: 'var(--k-fk)' }} />
        ) : null}
      </span>
      <span className={`wk-node-name${c.isForeignKey ? ' fk' : ''}`}>{nameOf(c)}</span>
      <span className="wk-node-dt rd-mono" title={isComplexType(c.dataType) ? c.dataType : undefined}>
        {collapseComplexType(c.dataType)}
      </span>
      {/* Las columnas no inician relaciones (el origen es la cabecera del
          padre); son el destino del drop en el hijo. */}
      <Handle type="source" position={Position.Right} id={`${c.id}__src`} isConnectable={connectable}
        isConnectableStart={false} className="wk-handle" />
      <Handle type="target" position={Position.Left} id={`${c.id}__tgt`} isConnectable={connectable}
        isConnectableStart={false} className="wk-handle" />
    </div>
  );

  return (
    // rel-armed: apaga el hover de filas (CSS) mientras se dibuja una relación.
    <div className={`wk-node${selected ? ' sel' : ''}${relArmed ? ' rel-armed' : ''}${hex ? ' tinted' : ''}`} style={tint}>
      <div className={`wk-node-head${connectable ? ' armed' : ''}`}>
        <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
        {/* Header = solo esquema.nombre del modo activo (lógico o físico); el
            nombre del otro modo no se muestra. Sin nowrap envolvería en varias
            líneas y estiraría el nodo hacia abajo al topar el max-width. */}
        <span className="rd-mono wk-node-title">
          {table.schema && <span className="wk-node-schema">{table.schema}.</span>}
          {nameOf(table)}
        </span>
        {canEdit && <button className="wk-node-add" title={`Add ${n.member}`} onClick={() => setColumnTarget(table.id)}>+</button>}
        {/* Origen de relaciones: con la herramienta armada, el header entero
            inicia el drag (hit-area .armed). Sin armar queda 1px invisible:
            sigue siendo el ancla de las derivaciones de vistas y de los wires
            crowfoot (sourceHandle __hdr_src). */}
        <Handle type="source" position={Position.Right} id="__hdr_src" isConnectable={connectable}
          className={`wk-hdr-handle${connectable ? ' armed' : ''}`}
          title={connectable ? 'Drag from this header onto a child table to create the relationship' : undefined} />
      </div>
      {(pks.length > 0 || (dragId && canDrag)) && (
        <div className={`wk-node-pk${over === 'pkzone' ? ' dropzone' : ''}`} {...zoneDrag}>
          {pks.map(renderRow)}
          {pks.length === 0 && <div className="wk-node-pkdrop">Drop here to make it a key column</div>}
        </div>
      )}
      {pks.length > 0 && rest.length > 0 && <div className="wk-node-div" />}
      {rest.map(renderRow)}
      {columns.length === 0 && <div className="wk-node-empty rd-small">No {n.members}</div>}
    </div>
  );
}

// memo: React Flow re-renderiza los custom nodes en cada update del grafo
// (pan/zoom/drag); sin memo, un canvas de 100 tablas × 30 columnas repinta
// ~3.000 filas + ~6.000 handles por frame.
export default memo(TableNode);
