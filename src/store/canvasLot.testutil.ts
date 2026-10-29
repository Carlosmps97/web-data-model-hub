/**
 * El envío único de `struct.canvasLot` (doc 133 §4) en los backends en memoria
 * de las pruebas que ya simulan aparte el lote del modelo y la escritura de un
 * canvas: el envío se reparte entre los dos, el modelo primero. El backend graba
 * todo junto y deja los canvases del lote como vienen (podados de lo que el
 * draft borra): el estado final es el mismo.
 *
 * Uso: `vi.mocked(csvc.recordChangesBulk).mockImplementation(lotTo(modelo, canvas))`;
 * `csvc.effective` debe responder todos los `ids` pedidos (`canvasLot` lee sus
 * canvases de una vez).
 */
import type * as Csvc from '@/services/changeset.service';

type Model = (changes: Csvc.BulkChange[]) => Promise<unknown>;
type Canvas = (
  cs: string, collection: string, entityId: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>,
) => Promise<unknown>;

export const lotTo = (model: Model, canvas: Canvas) =>
  async (cs: string, changes: Csvc.BulkChange[]): Promise<never> => {
    const rest = changes.filter((c) => c.collection !== 'subject_areas');
    if (rest.length) await model(rest);
    for (const c of changes) {
      if (c.collection === 'subject_areas') await canvas(cs, c.collection, c.entityId, c.op, c.payload);
    }
    return {} as never;
  };

/** Un canvas vacío de la versión. */
const emptyCanvas = (id: string) => ({
  id, projectId: 'p', name: id, folderId: null, tableIds: [], viewIds: [], layout: {}, drawings: [], udpValues: {}, routes: {},
});

/** `struct.canvasLot` para las pruebas que mockean `structure.service` entero
 *  (sin backend de canvases): arma el lote sobre un canvas vacío (o el que dé
 *  `docs`) y manda sus cambios del modelo, en un solo llamado, a `model` (el
 *  lote del modelo de la prueba). Lo que suma a cada canvas se mira en
 *  `planCanvasAdd`. */
export const canvasLotStub = (model: Model, docs: (id: string) => unknown = emptyCanvas) =>
  async <T>(ids: string[], build: (docs: Map<string, unknown>) => { changes: Csvc.BulkChange[]; result: T }): Promise<T> => {
    const plan = build(new Map(ids.map((id) => [id, docs(id)])));
    if (plan.changes.length) await model(plan.changes);
    return plan.result;
  };
