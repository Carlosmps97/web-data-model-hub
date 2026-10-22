/**
 * Revisión del pegado: qué viaja de la tabla o las columnas copiadas al
 * destino, faceta por faceta, y qué no se puede copiar. Pura: los popups piden
 * los estándares y los nombres; el store graba el `payload` que se mostró.
 *
 * Mismo proyecto: los UDP, dominios y themes se reconocen por id y viajan tal
 * cual (un valor fuera de la lista también: la copia no limpia datos); solo se
 * quita lo que fue borrado (definición UDP, dominio o theme).
 * Entre proyectos (cada proyecto tiene sus estándares): los nombres se comparan
 * como la carga Excel (`norm_name`: sin tildes, sin mayúsculas, espacios
 * colapsados); el UDP se busca en el destino por nombre + nivel + faceta y su
 * valor se valida con el tipo y la lista del destino (`udpValueFor`); el dominio
 * y el theme, por nombre; con dos candidatos es ambiguo y no viaja, igual que
 * dos UDP del origen que caen en el mismo del destino con valores distintos; el
 * dominio del destino recalcula los overrides de tipo; un theme que no existe
 * (o existe dos veces) se pega como su color fijo.
 * Siempre: la marca FK no viaja (la relación no se copia), la PK sí; el físico
 * de las columnas sale con el case del destino y un nombre sobre su tope
 * bloquea (el lote es atómico: el backend rechazaría todo el pegado).
 */
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import type { UdpDefinition } from '@/features/standards/standards.service';
import type { NamingConfig } from '@/services/naming.service';
import { normalColor, themeIdOf, themeRef, type Theme } from '@/lib/colors';
import { FACET_NOUNS, udpView, type Facet, type FacetNouns } from '@/lib/facets';
import { udpValueFor } from '@/lib/udpValue';
import type { DbSchema } from '../services/schemas.service';
import { applyNamingCase } from './physicalCase';
import { SCHEMA_NAME_RE } from './schemaStaging';
import { canonicalDefaultType } from './typePick';

/** Lo que la revisión usa de un parent domain (vale el de la lista del proyecto y el del snapshot de estándares). */
export interface PasteDomain {
  id: string; name: string; defaultDataType: string; logicalDataType?: string | null; physicalName?: string | null;
}
export interface PasteStandards { udpDefs: UdpDefinition[]; domains: PasteDomain[]; themes: Theme[] }
export interface PasteTarget extends PasteStandards { schemas: DbSchema[]; naming: NamingConfig | null }
/** Los checks del popup: UDPs de cada faceta y parent domains (un solo check:
 *  el dominio es uno solo para las dos facetas). */
export interface PasteOptions { logicalUdps: boolean; physicalUdps: boolean; domains: boolean }
export const ALL_COPY: PasteOptions = { logicalUdps: true, physicalUdps: true, domains: true };

/** 'copy' viaja · 'off' lo apagó su check · 'missing' no puede viajar (ver `reason`). */
export type PasteItemStatus = 'copy' | 'off' | 'missing';
/** Por qué no viaja: 'gone' fue borrado · 'absent' no existe en el destino ·
 *  'ambiguous' el destino tiene más de uno con ese nombre · 'value' el valor no
 *  vale para el UDP del destino · 'conflict' otro UDP del origen cae en el mismo
 *  del destino con otro valor · 'unavailable' no se leyeron los estándares del origen. */
export type PasteMissingReason = 'gone' | 'absent' | 'ambiguous' | 'value' | 'conflict' | 'unavailable';
export interface PasteUdpItem {
  defId: string; name: string; facet: Facet; value: string; status: PasteItemStatus; reason?: PasteMissingReason;
}
export interface PasteDomainItem {
  id: string; name: string; physicalName: string; status: PasteItemStatus; reason?: PasteMissingReason;
  /** Entre proyectos: los tipos del dominio del destino que difieren de los del
   *  dominio de origen («VARCHAR(40)», «logical VARCHAR(25)» o los dos). */
  typeDiffers?: string;
}
export interface PasteColumnItem {
  sourceId: string;
  logicalName: string;
  /** Físico final (con el case del destino). */
  physicalName: string;
  caseChanged: boolean;
  logicalType: string;
  physicalType: string;
  isPrimaryKey: boolean;
  /** Pegar columnas: su físico ya existe en la tabla destino — se lista, no viaja. */
  skipped: boolean;
  description: string;
  physicalDescription: string;
  domain: PasteDomainItem | null;
  udps: PasteUdpItem[];
}
export interface PasteSchemaItem { name: string; create: boolean; viewsKind: boolean }
export interface PasteReview {
  table: { schema: PasteSchemaItem | null; udps: PasteUdpItem[] } | null;
  columns: PasteColumnItem[];
  /** Lo que se graba: la tabla (con sus nombres ya decididos) y las columnas. */
  payload: { table?: CanonicalTable; cols: CanonicalColumn[]; createSchema?: { name: string } };
  /** Cuánto hay detrás de cada check (lo que existe en el destino). */
  counts: { logicalUdps: number; physicalUdps: number; domains: number };
  warnings: string[];
  blockers: string[];
}

interface Ctx {
  options: PasteOptions;
  same: boolean;
  unavailable: boolean;
  /** Destino por id. */
  defs: Map<string, UdpDefinition>;
  domains: Map<string, PasteDomain>;
  /** Origen por id (entre proyectos). */
  srcDefs: Map<string, UdpDefinition>;
  srcDomains: Map<string, PasteDomain>;
  /** Destino por clave de emparejamiento (entre proyectos). */
  defsByKey: Map<string, UdpDefinition[]>;
  domainsByName: Map<string, PasteDomain[]>;
}

const chars = (s: string) => [...s].length;
const SHORTEN = 'Shorten it in the source and copy it again, or raise the limit in Data Standards · Glossary.';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Clave de un nombre, como `norm_name` de la carga Excel: sin bordes, sin tildes,
 *  espacios internos colapsados y sin mayúsculas. */
const nameKey = (s: string) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').trim().split(/\s+/).join(' ').toLowerCase();
const udpKey = (d: UdpDefinition) => `${d.level}|${udpView(d)}|${nameKey(d.name)}`;
const udpLabel = (name: string, facet: Facet) => (facet === 'logical' ? `${name} (Logical)` : name);
const unique = (xs: string[]) => [...new Set(xs)];
const listed = (xs: string[]) => `${xs.slice(0, 5).join(', ')}${xs.length > 5 ? ` +${xs.length - 5} more` : ''}`;

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

/** Un UDP resuelto contra el destino, antes de su check: 'copy' (con el id y el
 *  valor que se grabarían) o 'missing'. */
function udpItem(defId: string, value: string, level: 'table' | 'column', ctx: Ctx): PasteUdpItem {
  const gone: PasteUdpItem = { defId, name: '', facet: 'physical', value, status: 'missing', reason: 'gone' };
  if (ctx.same) {
    const def = ctx.defs.get(defId);
    if (!def || def.level !== level) return gone;
    return { defId, name: def.name, facet: udpView(def), value, status: 'copy' };
  }
  if (ctx.unavailable) return { ...gone, reason: 'unavailable' };
  const src = ctx.srcDefs.get(defId);
  if (!src || src.level !== level) return gone;
  const facet = udpView(src);
  const found = ctx.defsByKey.get(udpKey(src)) ?? [];
  if (found.length !== 1) return { defId, name: src.name, facet, value, status: 'missing', reason: found.length ? 'ambiguous' : 'absent' };
  const def = found[0];
  const ok = udpValueFor(def, value);
  return ok === null
    ? { defId: def.id, name: def.name, facet, value, status: 'missing', reason: 'value' }
    : { defId: def.id, name: def.name, facet, value: ok, status: 'copy' };
}

/** Los UDP de una tabla o columna: cada uno resuelto y, al final, su check (así
 *  los conteos y los avisos no cambian al tocarlo). */
function udpItems(values: Record<string, string> | undefined, level: 'table' | 'column', ctx: Ctx): PasteUdpItem[] {
  const resolved = Object.entries(values ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== '')
    .map(([defId, v]) => udpItem(defId, String(v), level, ctx));
  // Entre proyectos, dos UDP del origen pueden caer en el mismo del destino: con
  // el mismo valor viaja uno; con valores distintos, ninguno (no hay cómo elegir).
  const byDef = groupBy(resolved.filter((u) => u.status === 'copy'), (u) => u.defId);
  const kept: PasteUdpItem[] = [];
  for (const u of resolved) {
    const group = u.status === 'copy' ? byDef.get(u.defId) ?? [u] : [u];
    if (group.some((o) => o.value !== u.value)) kept.push({ ...u, status: 'missing', reason: 'conflict' });
    else if (group[0] === u) kept.push(u);
  }
  const on = (f: Facet) => (f === 'logical' ? ctx.options.logicalUdps : ctx.options.physicalUdps);
  return kept.map((u) => (u.status === 'copy' && !on(u.facet) ? { ...u, status: 'off' } : u));
}

const copiedValues = (items: PasteUdpItem[]): Record<string, string> | undefined => {
  const kept = items.filter((i) => i.status === 'copy');
  return kept.length ? Object.fromEntries(kept.map((i) => [i.defId, i.value])) : undefined;
};

function domainItem(c: CanonicalColumn, ctx: Ctx): PasteDomainItem | null {
  if (!c.parentDomainId) return null;
  const status: PasteItemStatus = ctx.options.domains ? 'copy' : 'off';
  const gone: PasteDomainItem = { id: c.parentDomainId, name: '', physicalName: '', status: 'missing', reason: 'gone' };
  if (ctx.same) {
    const d = ctx.domains.get(c.parentDomainId);
    return d ? { id: d.id, name: d.name, physicalName: d.physicalName || d.name, status } : gone;
  }
  if (ctx.unavailable) return { ...gone, reason: 'unavailable' };
  const src = ctx.srcDomains.get(c.parentDomainId);
  if (!src) return gone;
  const found = ctx.domainsByName.get(nameKey(src.name)) ?? [];
  if (found.length !== 1) {
    return { id: src.id, name: src.name, physicalName: src.physicalName || src.name, status: 'missing', reason: found.length ? 'ambiguous' : 'absent' };
  }
  const d = found[0];
  // El aviso compara los dominios: la columna conserva su tipo y su override se
  // recalcula contra el del destino (`overrides`).
  const physical = canonicalDefaultType(d.defaultDataType);
  const logical = canonicalDefaultType(d.logicalDataType ?? undefined);
  const differs = [
    physical !== canonicalDefaultType(src.defaultDataType) ? physical || '—' : '',
    logical !== canonicalDefaultType(src.logicalDataType ?? undefined) ? (logical ? `logical ${logical}` : 'no logical type') : '',
  ].filter(Boolean).join(', ');
  return { id: d.id, name: d.name, physicalName: d.physicalName || d.name, status, ...(differs ? { typeDiffers: differs } : {}) };
}

/** Overrides de tipo de una columna que viaja con `domain` (null = sin dominio:
 *  sin override). En el mismo proyecto, los suyos; entre proyectos, contra el
 *  dominio del destino: override = tipo distinto del default homologado del
 *  dominio en esa faceta, como al editar el tipo de una columna con dominio en la
 *  UI (`typeFacetPatch`). */
function overrides(c: CanonicalColumn, domain: PasteDomain | null, same: boolean): Pick<CanonicalColumn, 'typeOverridden' | 'logicalTypeOverridden'> {
  if (!domain) return { typeOverridden: false, logicalTypeOverridden: false };
  if (same) return { typeOverridden: c.typeOverridden, logicalTypeOverridden: c.logicalTypeOverridden };
  return {
    typeOverridden: canonicalDefaultType(c.dataType) !== canonicalDefaultType(domain.defaultDataType),
    logicalTypeOverridden: !!c.logicalDataType && canonicalDefaultType(c.logicalDataType) !== canonicalDefaultType(domain.logicalDataType ?? undefined),
  };
}

export function reviewPaste(input: {
  /** Tabla a pegar con sus nombres finales (`pasteNames`); sin ella, se pegan columnas. */
  table?: CanonicalTable;
  cols: CanonicalColumn[];
  /** Estándares del proyecto de origen y del destino (en el mismo proyecto, los mismos). */
  source: PasteStandards;
  target: PasteTarget;
  sameProject: boolean;
  options: PasteOptions;
  /** Sustantivos de la faceta abierta para los avisos (default: Table/Column). */
  nouns?: FacetNouns;
  /** Pegar columnas: ids de las que se omiten (su físico ya existe en el destino). */
  skip?: ReadonlySet<string>;
  /** Entre proyectos: no se pudieron leer los estándares del origen (p. ej. ese proyecto fue borrado). */
  sourceUnavailable?: boolean;
  /** Nombre del proyecto de origen, para los avisos. */
  sourceName?: string;
}): PasteReview {
  const { table, target, options } = input;
  const n = input.nouns ?? FACET_NOUNS.physical;
  const same = input.sameProject;
  const ctx: Ctx = {
    options, same, unavailable: !same && !!input.sourceUnavailable,
    defs: new Map(target.udpDefs.map((d) => [d.id, d])),
    domains: new Map(target.domains.map((d) => [d.id, d])),
    srcDefs: new Map(input.source.udpDefs.map((d) => [d.id, d])),
    srcDomains: new Map(input.source.domains.map((d) => [d.id, d])),
    defsByKey: groupBy(target.udpDefs, udpKey),
    domainsByName: groupBy(target.domains, (d) => nameKey(d.name)),
  };
  const warnings: string[] = [];
  const blockers: string[] = [];

  let tableOut: PasteReview['table'] = null;
  let tablePayload: CanonicalTable | undefined;
  let createSchema: { name: string } | undefined;
  let themeUnavailable = false;
  if (table) {
    const udps = udpItems(table.udpValues, 'table', ctx);
    // Color: el theme por id (mismo proyecto) o por nombre (entre proyectos); uno
    // que no existe en el destino se pega como su color fijo.
    let color = table.color ?? null;
    const themeId = themeIdOf(table.color);
    if (themeId) {
      const srcTheme = same || ctx.unavailable ? undefined : input.source.themes.find((t) => t.id === themeId);
      const named = srcTheme ? target.themes.filter((t) => nameKey(t.name) === nameKey(srcTheme.name)) : [];
      const destTheme = same ? target.themes.find((t) => t.id === themeId) : named.length === 1 ? named[0] : undefined;
      if (destTheme) color = themeRef(destTheme.id);
      else if (ctx.unavailable) { color = null; themeUnavailable = true; }
      else if (srcTheme && normalColor(srcTheme.color)) {
        color = normalColor(srcTheme.color);
        warnings.push(named.length > 1
          ? `Theme «${srcTheme.name}» exists more than once in this project — the ${n.one} gets its color as a fixed color (${color}).`
          : `Theme «${srcTheme.name}» doesn't exist in this project — the ${n.one} gets its color as a fixed color (${color}).`);
      } else {
        color = null;
        warnings.push(`The ${n.one} color uses a theme that no longer exists — it is pasted without color.`);
      }
    }
    const wanted = (table.schema ?? '').trim();
    let schema: PasteSchemaItem | null = null;
    if (wanted) {
      const hit = target.schemas.find((s) => s.name.trim().toLowerCase() === wanted.toLowerCase());
      // Un nombre que el catálogo no admite (texto libre) no se crea: queda como texto, como en la fuente.
      const creatable = SCHEMA_NAME_RE.test(wanted);
      schema = hit ? { name: hit.name, create: false, viewsKind: hit.kind === 'views' } : { name: wanted, create: creatable, viewsKind: false };
      if (schema.viewsKind) warnings.push(`Schema «${schema.name}» exists in this project as a views schema — the ${n.one} goes into it.`);
      if (!hit && !creatable) warnings.push(`«${wanted}» isn't a valid schema name — the ${n.one} keeps it, but it isn't created as a schema.`);
      if (schema.create) createSchema = { name: schema.name };
    }
    tableOut = { schema, udps };
    tablePayload = { ...table, udpValues: copiedValues(udps), color, schema: schema?.name };
    const max = target.naming?.table?.maxLength ?? 0;
    if (max > 0 && chars(table.physicalName) > max) {
      blockers.push(`The table name «${table.physicalName}» has ${chars(table.physicalName)} characters, over this project's ${max}-character limit. ${SHORTEN}`);
    }
  }

  const columnCase = target.naming?.column?.case;
  const columns: PasteColumnItem[] = [];
  const cols: CanonicalColumn[] = [];
  for (const c of input.cols) {
    const udps = udpItems(c.udpValues, 'column', ctx);
    const domain = domainItem(c, ctx);
    const keep = domain?.status === 'copy' ? ctx.domains.get(domain.id) ?? null : null;
    const physicalName = applyNamingCase(c.physicalName, columnCase);
    const skipped = !!input.skip?.has(c.id);
    columns.push({
      sourceId: c.id, logicalName: c.logicalName, physicalName, caseChanged: physicalName !== c.physicalName,
      logicalType: c.logicalDataType || c.dataType, physicalType: c.dataType, isPrimaryKey: !!c.isPrimaryKey,
      skipped, description: c.description ?? '', physicalDescription: c.physicalDescription ?? '', domain, udps,
    });
    if (skipped) continue;
    cols.push({
      ...c,
      physicalName,
      udpValues: copiedValues(udps),
      parentDomainId: keep ? keep.id : undefined,
      ...overrides(c, keep, same),
      isForeignKey: undefined,
    });
  }

  const pasted = columns.filter((c) => !c.skipped);
  const allUdps = [...(tableOut?.udps ?? []), ...pasted.flatMap((c) => c.udps)];
  const domains = pasted.flatMap((c) => (c.domain ? [c.domain] : []));
  const why = (reason: PasteMissingReason) => allUdps.filter((u) => u.reason === reason);
  if (ctx.unavailable && (why('unavailable').length || domains.some((d) => d.reason === 'unavailable') || themeUnavailable)) {
    warnings.push(`The standards of «${input.sourceName || 'the source project'}» can't be read — its UDPs, parent domains and theme colors won't be copied.`);
  }
  const gone = why('gone').length;
  if (gone) {
    warnings.push(gone === 1
      ? "1 UDP value belongs to a UDP that no longer exists or doesn't apply here — it won't be copied."
      : `${gone} UDP values belong to UDPs that no longer exist or don't apply here — they won't be copied.`);
  }
  // Entre proyectos solo se avisa lo que su check iba a llevar.
  const wanted = (u: PasteUdpItem) => (u.facet === 'logical' ? options.logicalUdps : options.physicalUdps);
  const absent = unique(why('absent').filter(wanted).map((u) => udpLabel(u.name, u.facet)));
  if (absent.length) warnings.push(`UDPs that don't exist in this project won't be copied: ${listed(absent)}.`);
  const twice = unique(why('ambiguous').filter(wanted).map((u) => udpLabel(u.name, u.facet)));
  if (twice.length) warnings.push(`UDPs that exist more than once in this project won't be copied: ${listed(twice)}.`);
  const clash = unique(why('conflict').filter(wanted).map((u) => udpLabel(u.name, u.facet)));
  if (clash.length) warnings.push(`UDPs of the source that match the same UDP here with different values won't be copied: ${listed(clash)}.`);
  const values = unique(why('value').filter(wanted).map((u) => `${u.name} = «${u.value}»`));
  if (values.length) warnings.push(`Values not allowed in this project won't be copied: ${listed(values)}.`);

  const goneDomains = domains.filter((d) => d.reason === 'gone').length;
  if (goneDomains) {
    warnings.push(goneDomains === 1
      ? `1 ${n.member} points to a parent domain that no longer exists — it is pasted without it.`
      : `${goneDomains} ${n.members} point to parent domains that no longer exist — they are pasted without them.`);
  }
  if (options.domains) {
    const absentD = unique(domains.filter((d) => d.reason === 'absent').map((d) => d.name));
    if (absentD.length) warnings.push(`Parent domains that don't exist in this project: ${listed(absentD)} — those ${n.members} are pasted without a domain.`);
    const twiceD = unique(domains.filter((d) => d.reason === 'ambiguous').map((d) => d.name));
    if (twiceD.length) warnings.push(`Parent domains that exist more than once in this project: ${listed(twiceD)} — those ${n.members} are pasted without a domain.`);
    const differ = new Map(domains.filter((d) => d.status === 'copy' && d.typeDiffers).map((d) => [d.name, d.typeDiffers!]));
    for (const [name, type] of differ) {
      warnings.push(`Parent domain «${name}» exists here with another type (${type}) — the copied ${n.members} keep their own type.`);
    }
  }

  const max = target.naming?.column?.maxLength ?? 0;
  const long = max > 0 ? pasted.filter((c) => chars(c.physicalName) > max).map((c) => c.physicalName) : [];
  if (long.length) {
    blockers.push(`${long.length} column ${plural(long.length, 'name is', 'names are')} over this project's ${max}-character limit: `
      + `${listed(long)}. `
      + (long.length === 1 ? SHORTEN : 'Shorten them in the source and copy again, or raise the limit in Data Standards · Glossary.'));
  }
  const seen = new Map<string, number>();
  for (const c of pasted) seen.set(c.physicalName.toLowerCase(), (seen.get(c.physicalName.toLowerCase()) ?? 0) + 1);
  const dups = pasted.filter((c, i) => (seen.get(c.physicalName.toLowerCase()) ?? 0) > 1
    && pasted.findIndex((o) => o.physicalName.toLowerCase() === c.physicalName.toLowerCase()) === i).map((c) => c.physicalName);
  if (dups.length) blockers.push(`Columns end up with the same physical name: ${dups.slice(0, 5).join(', ')}.`);

  // Lo que se reutiliza: UDPs (definiciones) y dominios distintos que existen en el destino.
  const facetCount = (facet: Facet) => new Set(allUdps.filter((u) => u.facet === facet && u.status !== 'missing').map((u) => u.defId)).size;
  return {
    table: tableOut,
    columns,
    payload: { ...(tablePayload ? { table: tablePayload } : {}), cols, ...(createSchema ? { createSchema } : {}) },
    counts: {
      logicalUdps: facetCount('logical'),
      physicalUdps: facetCount('physical'),
      domains: new Set(domains.filter((d) => d.status !== 'missing').map((d) => d.id)).size,
    },
    warnings,
    blockers,
  };
}
