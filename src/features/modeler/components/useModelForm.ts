import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { reseedForm } from '../lib/modelForm';

/** Lo sembrado: el objeto, sus valores (y su firma) y el formulario. */
interface Seed<T> { id: string | undefined; sig: string; values: T; form: T }

/**
 * Formulario local de un panel de propiedades: se siembra con el objeto `id` y,
 * cuando sus valores cambian en el modelo (un Undo o Redo, el propio guardado),
 * cada campo sin cambios locales toma el valor nuevo (`reseedForm`); lo que se
 * está escribiendo se conserva. Otro objeto se siembra entero. Se siembra en el
 * mismo render en que llegan los valores (el patrón de React para ajustar el
 * estado cuando cambia una prop): nunca se muestra otro objeto ni un formulario
 * a medias. Sin objeto (`values` null) queda lo último, o `empty` si todavía no
 * hubo ninguno.
 */
export function useModelForm<T extends Record<string, string>>(id: string | undefined, values: T | null, empty: T): [T, Dispatch<SetStateAction<T>>] {
  const [seed, setSeed] = useState<Seed<T> | null>(null);
  const sig = values ? JSON.stringify(values) : '';
  let shown = seed;
  if (values && (!seed || seed.id !== id || seed.sig !== sig)) {
    shown = { id, sig, values, form: seed && seed.id === id ? reseedForm(seed.form, seed.values, values) : values };
    setSeed(shown);
  }
  const setForm = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setSeed((s) => (s ? { ...s, form: typeof next === 'function' ? next(s.form) : next } : s));
  }, []);
  return [shown?.form ?? empty, setForm];
}
