/**
 * Estado puro del editor de perfiles: perfil vacío, conversión
 * doc → body, merge de sugerencias sin pisar lo mapeado, reglas por tipo y
 * la validación estructural local (espejo de lo que el backend rechaza con
 * 422 — el servidor sigue siendo la autoridad).
 */
import type {
  ProfileMapping, ProfileProblem, ProfileRule, ProfileSheet, RuleType, SheetRole, Suggestion,
  UploadProfile, UploadProfileBody,
} from '../upload.service';
import { headerKey, sheetKey } from './parseWorkbook';

export const ROLES: SheetRole[] = ['tables', 'columns'];
export const ROLE_LABEL: Record<SheetRole, string> = { tables: 'Tables sheet', columns: 'Columns sheet' };
export const IDENTITY_FIELDS: Record<SheetRole, string[]> = {
  tables: ['logicalName', 'physicalName'],
  columns: ['tableRef', 'logicalName', 'physicalName'],
};

export function emptySheet(): ProfileSheet {
  return { name: '', required: true, headerRow: 1, mappings: [] };
}

export function emptyProfile(): UploadProfileBody {
  return {
    name: '', description: '', isDefault: false,
    sheets: { tables: emptySheet(), columns: emptySheet() },
    policies: { onExistingTable: 'update', onExistingColumn: 'update', unknownHeaders: 'warn' },
  };
}

export const emptyMapping = (header = ''): ProfileMapping => ({ header, target: { kind: 'ignore' }, rules: [], defaultValue: null });

/** Doc → body editable (copia profunda: el editor muta su borrador). */
export function toBody(p: UploadProfile): UploadProfileBody {
  return {
    name: p.name, description: p.description ?? '', isDefault: p.isDefault,
    sheets: {
      tables: { ...emptySheet(), ...(p.sheets?.tables ?? {}), mappings: (p.sheets?.tables?.mappings ?? []).map(cloneMapping) },
      columns: { ...emptySheet(), ...(p.sheets?.columns ?? {}), mappings: (p.sheets?.columns?.mappings ?? []).map(cloneMapping) },
    },
    policies: { ...emptyProfile().policies, ...(p.policies ?? {}) },
  };
}

export const cloneMapping = (m: ProfileMapping): ProfileMapping => ({
  header: m.header,
  target: { kind: m.target.kind, field: m.target.field ?? null, udpIds: [...(m.target.udpIds ?? [])] },
  rules: (m.rules ?? []).map((r) => ({ ...r, value: Array.isArray(r.value) ? [...r.value] : r.value })),
  defaultValue: m.defaultValue ?? null,
});

/** Agrega las cabeceras sugeridas que faltan (por `headerKey`); nunca pisa un mapeo existente. */
export function mergeSuggestions(sheet: ProfileSheet, suggestions: Suggestion[]): ProfileSheet {
  const have = new Set(sheet.mappings.map((m) => headerKey(m.header)));
  const added: ProfileMapping[] = [];
  for (const s of suggestions) {
    const hk = headerKey(s.header);
    if (!hk || have.has(hk)) continue;
    have.add(hk);
    added.push({ header: s.header, target: { ...s.target, udpIds: [...(s.target.udpIds ?? [])] }, rules: [], defaultValue: null });
  }
  return { ...sheet, mappings: [...sheet.mappings, ...added] };
}

export const upsertRule = (m: ProfileMapping, rule: ProfileRule): ProfileMapping =>
  ({ ...m, rules: [...m.rules.filter((r) => r.type !== rule.type), rule] });
export const removeRule = (m: ProfileMapping, type: RuleType): ProfileMapping =>
  ({ ...m, rules: m.rules.filter((r) => r.type !== type) });
export const ruleOf = (m: ProfileMapping, type: RuleType): ProfileRule | undefined => m.rules.find((r) => r.type === type);

export const mappingPath = (role: SheetRole, i: number) => `sheets.${role}.mappings[${i}]`;

/** Chequeos estructurales que no necesitan al servidor (mismos códigos que `validate_profile`). */
export function localProblems(p: UploadProfileBody): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  if (!p.name.trim()) out.push({ path: 'name', code: 'name-empty', message: 'The profile needs a name.' });
  const names = new Map<string, SheetRole>();
  for (const role of ROLES) {
    const s = p.sheets[role];
    const nm = s.name.trim();
    if (!nm) out.push({ path: `sheets.${role}.name`, code: 'sheet-name-empty', message: 'Give the sheet a name (as it appears in Excel).' });
    else if (names.has(sheetKey(nm))) out.push({ path: `sheets.${role}.name`, code: 'sheet-names-equal', message: 'Both sheets have the same name.' });
    else names.set(sheetKey(nm), role);
    if (s.headerRow != null && (!Number.isInteger(s.headerRow) || s.headerRow < 1)) {
      out.push({ path: `sheets.${role}.headerRow`, code: 'header-row-invalid', message: 'Header row must be a positive row number (or empty to auto-detect).' });
    }
    const seen = new Map<string, number>();
    s.mappings.forEach((m, i) => {
      const hk = headerKey(m.header);
      if (!hk) out.push({ path: `${mappingPath(role, i)}.header`, code: 'header-empty', message: 'Every mapping needs the Excel header text.' });
      else if (seen.has(hk)) out.push({ path: `${mappingPath(role, i)}.header`, code: 'header-duplicate', message: `'${m.header}' is mapped twice (see mapping #${seen.get(hk)! + 1}).` });
      else seen.set(hk, i);
      if (m.target.kind === 'udp' && !(m.target.udpIds ?? []).length) {
        out.push({ path: `${mappingPath(role, i)}.target`, code: 'udp-empty', message: 'Pick at least one UDP for this column.' });
      }
    });
  }
  return out;
}

export function problemsByPath(problems: ProfileProblem[]): Map<string, ProfileProblem[]> {
  const m = new Map<string, ProfileProblem[]>();
  for (const p of problems) m.set(p.path, [...(m.get(p.path) ?? []), p]);
  return m;
}

/** Problemas cuyo path cae dentro de un mapeo (`…mappings[i]` y sus hijos). */
export function problemsOfMapping(problems: ProfileProblem[], role: SheetRole, i: number): ProfileProblem[] {
  const prefix = mappingPath(role, i);
  return problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));
}
