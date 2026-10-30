/**
 * standardsDiff — ¿el guardado de una pantalla de Data Standards cambia algo?
 * Se compara lo que se enviaría contra lo vigente, normalizado igual que el
 * envío (recortes; un opcional ausente ≡ vacío). Sin cambio real el botón de
 * guardar queda deshabilitado con «No changes to apply», como el glosario con
 * su diff, para no registrar una versión vacía. El backend responde 422 «There
 * are no changes to apply.» a un lote sin cambios efectivos; si igual llega, es
 * un aviso neutro, no un error. Puro.
 */
import { ApiError } from '@/services/http';
import { mergeOutputSettings, type DdlOutputSettings } from '@/features/ddl';
import { domainEditInput } from './domainForm';
import { toEditInput } from './ddlRules.service';
import type {
  DdlRule, DdlRuleEditInput, DdlRulesetConfig, DomainEditInput, SnapshotDomain, UdpDataType, UdpDefinition,
  UdpEditInput, UdpLevel, UdpView,
} from './standards.service';

/** Texto del 422 del backend (`NO_CHANGES` de data_standards/service.py). */
export const NO_CHANGES = 'There are no changes to apply.';
/** `title` / nota de un botón de guardar sin cambios. */
export const NO_CHANGES_HINT = 'No changes to apply';

/** Aviso de un apply que falló: el 422 «sin cambios» es neutro (info); el resto, error. */
export function applyErrorNotice(err: unknown, fallback: string): { kind: 'info' | 'error'; text: string } {
  if (err instanceof ApiError && err.status === 422 && err.message === NO_CHANGES) return { kind: 'info', text: NO_CHANGES };
  return { kind: 'error', text: err instanceof Error && err.message ? err.message : fallback };
}

/** Igualdad profunda de datos JSON: sin importar el orden de las claves (los arrays, sí). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length
    && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Mapa sin los valores vacíos (un UDP/valor vaciado = sin valor). */
const filled = (m: Record<string, string | null | undefined> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).filter((e): e is [string, string] => e[1] != null && e[1] !== ''));

// ── Parent Domains ──────────────────────────────────────────────────────────

/** Dominio: ¿el apply cambia algo? `stored` null = alta (siempre). Un campo que
 *  no viaja (`domainEditInput` lo omite: el backend hace `exclude_none`) queda
 *  como estaba; lo demás se compara con lo guardado normalizado igual. Sirve
 *  también para el «Revert to vN»: revertir a una versión igual a la vigente no
 *  es un cambio. */
export function domainChanged(form: SnapshotDomain, stored: SnapshotDomain | null): boolean {
  if (!stored) return true;
  const next = domainEditInput(form, stored);
  const base = domainEditInput(stored, stored);
  const norm = (k: keyof DomainEditInput, v: unknown) => (k === 'udpValues' ? filled(v as Record<string, string>) : v ?? '');
  return (Object.keys(next) as (keyof DomainEditInput)[])
    .some((k) => k !== 'id' && next[k] !== undefined && !sameValue(norm(k, next[k]), norm(k, base[k])));
}

// ── UDP ─────────────────────────────────────────────────────────────────────

export interface UdpForm {
  id?: string; name: string; dataType: UdpDataType; defaultValue: string; allowedValues: string[]; description: string;
}

/** Formulario del editor cargado desde una definición guardada. */
export const udpFormOf = (d: UdpDefinition): UdpForm => ({
  id: d.id, name: d.name, dataType: d.dataType, defaultValue: d.defaultValue ?? '',
  allowedValues: [...d.allowedValues], description: d.description ?? '',
});

/** Texto opcional: con valor viaja; vaciado viaja '' solo si lo guardado tenía
 *  valor (el backend guarda solo lo presente: ausente = queda como estaba). */
const clearable = (value: string, stored: string | null | undefined): string | undefined =>
  (value ? value : stored ? '' : undefined);

/** Cuerpo del upsert de una definición UDP (lo que envía «Save & apply»).
 *  Vaciar el default o la descripción guardados viaja como '': así se limpian. */
export function udpEditInput(form: UdpForm, seg: { level: UdpLevel; view: UdpView }, stored: UdpDefinition | null): UdpEditInput {
  return {
    id: stored ? form.id : undefined, name: form.name.trim(), level: seg.level, view: seg.view, dataType: form.dataType,
    defaultValue: clearable(form.defaultValue.trim(), stored?.defaultValue),
    allowedValues: form.dataType === 'list' ? form.allowedValues.map((x) => x.trim()).filter(Boolean) : [],
    description: clearable(form.description.trim(), stored?.description),
  };
}

/** Definición UDP: ¿el guardado cambia algo? `stored` null = alta (siempre). */
export function udpChanged(form: UdpForm, seg: { level: UdpLevel; view: UdpView }, stored: UdpDefinition | null): boolean {
  if (!stored) return true;
  const next = udpEditInput(form, seg, stored);
  const base = udpEditInput(udpFormOf(stored), seg, stored);
  return (Object.keys(next) as (keyof UdpEditInput)[])
    .some((k) => k !== 'id' && next[k] !== undefined && !sameValue(next[k], base[k] ?? ''));
}

// ── Reglas del Export DDL ────────────────────────────────────────────────────

/** Lo que define una regla (sin `id`); opcional ausente ≡ vacío. */
const ruleShape = (r: DdlRuleEditInput) => ({
  name: r.name, description: r.description ?? '', scope: r.scope, when: r.when ?? '',
  files: (r.files ?? []).map((f) => ({ name: f.name ?? '', content: f.content ?? '' })),
  order: r.order, enabled: r.enabled,
});

/** Regla: ¿el guardado cambia algo? `stored` null = alta (siempre). */
export function ruleChanged(draft: DdlRuleEditInput, stored: DdlRule | null): boolean {
  if (!stored) return true;
  return !sameValue(ruleShape(draft), ruleShape(toEditInput(stored)));
}

/** Piezas y variables: ¿el guardado cambia algo? */
export function ddlConfigChanged(pieces: string, variables: Record<string, string>, config: DdlRulesetConfig): boolean {
  return pieces !== (config.pieces ?? '') || !sameValue(variables, config.variables ?? {});
}

/** Output settings: ¿el guardado cambia algo? Lo guardado se lee con sus
 *  defaults (lo mismo que muestra el formulario). */
export function outputChanged(value: DdlOutputSettings, stored: Record<string, unknown> | null | undefined): boolean {
  return !sameValue(value, mergeOutputSettings(stored ?? null));
}
