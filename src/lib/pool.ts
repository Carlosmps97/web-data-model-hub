/**
 * Doc 105 (B8): corre `fn` sobre `items` con a lo sumo `limit` pedidos en vuelo
 * (menos de 1 ⇒ de a uno). El resultado conserva el orden de `items`. Al primer
 * error deja de despachar y rechaza con ESE error; lo que ya estaba en vuelo
 * termina solo y se descarta (un segundo error no queda sin manejar).
 *
 * Por qué: el timeout de cada pedido (`http.ts`, 30 s) corre desde que SALE —
 * con 50 lotes a la vez los últimos esperaban en la cola del navegador y del
 * servidor y se vencían sin haber empezado.
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 0, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}
