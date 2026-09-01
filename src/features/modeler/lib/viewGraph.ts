// Armado PURO de los nodos 'view' y edges 'derivation' del canvas (F3,
// spec §3-5) — separado de ModelerCanvas para testearlo sin React.
//
// Contrato compartido F3:
//   - node type 'view'; posición en SubjectArea.layout[viewId] = {x,y}
//   - edge type 'derivation'; id = `deriv__{viewId}__{tableId}`,
//     source=tableId (handle '__hdr_src'), target=viewId (handle '__hdr_tgt')
import type { Edge, Node } from '@xyflow/react';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';
import type { View } from '@/services/views.service';

/** Offset del default: la vista aparece a la derecha de su primera fuente. */
const VIEW_OFFSET_X = 280;

/** Fuentes canónicas de una vista, con fallback al `tableId` legacy. */
export function viewSourceIds(v: View): string[] {
  return v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
}

export interface ViewNodeRow { name: string; type: string; fx: boolean; }

/** Filas del nodo VISTA: `outputAlias||column` + `castType||tipo origen`, con
 *  marca `fx` si hay expresión o cast (pedido 5). `colTypes` viene indexado
 *  por `${tableId}::${physicalName}` (lo arma buildViewGraph). */
export function viewNodeRows(view: View, colTypes: Record<string, string>): ViewNodeRow[] {
  // Doc 61 — vista PERSONALIZADA: las filas salen de customColumns (derivadas
  // del parse del script por el backend); el tipo no se conoce (expresión
  // libre) y `fx` marca las salidas que no son columna directa.
  if ((view.customSql ?? '').trim()) {
    return (view.customColumns ?? []).map((c) => ({
      name: c.name, type: '', fx: !!(c.expression ?? '').trim(),
    }));
  }
  const first = viewSourceIds(view)[0] ?? '';
  return (view.sources ?? [])
    .filter((s) => s.column || s.expression)
    .map((s) => {
      const cast = (s.castType ?? '').trim();
      return {
        name: (s.outputAlias ?? '').trim() || s.column || s.expression || '',
        type: cast || colTypes[`${s.tableId ?? first}::${s.column ?? ''}`] || '',
        fx: !!((s.expression ?? '').trim() || cast),
      };
    });
}

/** Nodos 'view' + edges 'derivation' a partir de `diagram.views`.
 *  - posición: `layout[viewId]`, o default junto a la primera fuente PRESENTE
 *    (x + 280, misma y);
 *  - un edge por fuente presente en el canvas (las ausentes no dibujan wire);
 *  - vistas sin ninguna fuente presente se saltan (defensivo: el backend ya
 *    filtra por `sourceTableIds ∩ canvas.tableIds`). */
export function buildViewGraph(
  views: View[],
  tables: CanonicalTable[],
  columns: CanonicalColumn[],
  layout: Record<string, { x: number; y: number }>,
  tablePos: Map<string, { x: number; y: number }>,
  onEdit: (viewId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const tableById = new Map(tables.map((t) => [t.id, t]));
  // dataType por `${tableId}::${physicalName}` para las filas del ViewNode.
  const colTypes: Record<string, string> = {};
  for (const c of columns) colTypes[`${c.tableId}::${c.physicalName}`] = c.dataType;

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const v of views) {
    const srcIds = viewSourceIds(v);
    const present = srcIds.filter((id) => tablePos.has(id));
    if (!present.length) continue;
    const anchor = tablePos.get(present[0])!;
    nodes.push({
      id: v.id,
      type: 'view',
      position: layout[v.id] ?? { x: anchor.x + VIEW_OFFSET_X, y: anchor.y },
      data: {
        view: v,
        sourceTables: srcIds.map((id) => tableById.get(id)).filter((t): t is CanonicalTable => !!t),
        colTypes,
        onEdit,
      },
    });
    for (const tid of present) {
      edges.push({
        id: `deriv__${v.id}__${tid}`,
        source: tid,
        target: v.id,
        sourceHandle: '__hdr_src',
        targetHandle: '__hdr_tgt',
        type: 'derivation',
      });
    }
  }
  return { nodes, edges };
}
