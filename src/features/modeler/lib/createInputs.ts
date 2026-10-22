/**
 * createInputs: payloads de alta según el modelo activo. El selector global
 * lógico/físico gobierna los popups: en Logical lo tipeado es el nombre lógico
 * (el físico lo deriva el store por glosario) y el tipo es el lógico; en
 * Physical lo tipeado es el físico (regla de case del scope) y el tipo es el
 * físico. Puro (testeable sin DOM).
 */
import type { Facet } from '@/lib/facets';
import type { AddColumnInput } from '@/store/useModelerStore';
import { applyNamingCase } from './physicalCase';

export interface ColumnCreateForm {
  name: string; parentDomainId: string; typeText: string; description: string; physicalDescription: string;
  isPrimaryKey: boolean; isForeignKey: boolean; isNullable: boolean; isPartition: boolean;
  udpValues: Record<string, string>;
}

/** En Logical el tipo tipeado es `logicalDataType`; el físico sale del
 *  dominio (dataType ausente ⇒ el store usa el default físico) o, sin dominio,
 *  es el mismo tipo. En Physical el tipo tipeado es `dataType`. */
export function columnCreateInput(
  facet: Facet, f: ColumnCreateForm, domain: { defaultDataType: string; logicalDataType?: string | null } | undefined,
): AddColumnInput {
  const typed = f.typeText.trim();
  const base: AddColumnInput = {
    logicalName: f.name.trim(), mode: facet, parentDomainId: f.parentDomainId || undefined,
    description: f.description.trim() || undefined,
    physicalDescription: f.physicalDescription.trim() || undefined,
    isPrimaryKey: f.isPrimaryKey, isForeignKey: f.isForeignKey, isNullable: f.isNullable, isPartition: f.isPartition,
    udpValues: Object.keys(f.udpValues).length ? f.udpValues : undefined,
  };
  if (facet === 'physical') return { ...base, dataType: typed || undefined };
  return {
    ...base,
    logicalDataType: typed || undefined,
    dataType: domain ? undefined : (typed || undefined),
  };
}

export interface TableCreateForm { name: string; schema: string; description: string; udpValues: Record<string, string> }
export interface TableCreateInput {
  logicalName: string; physicalName?: string; schema?: string; mode: Facet; description?: string; udpValues?: Record<string, string>;
}

/** New entity (Logical) = nombre lógico, sin schema (se asigna en Physical);
 *  New table (Physical) = físico tipeado con la regla de case del scope table,
 *  lógico = lo tipeado (editable luego en Logical), schema. */
export function tableCreateInput(facet: Facet, f: TableCreateForm, tableCase: string | undefined): TableCreateInput {
  const name = f.name.trim();
  const description = f.description.trim() || undefined;
  const udpValues = Object.keys(f.udpValues).length ? f.udpValues : undefined;
  if (facet === 'logical') {
    return { logicalName: name, mode: 'logical', ...(description ? { description } : {}), ...(udpValues ? { udpValues } : {}) };
  }
  return {
    logicalName: name, physicalName: applyNamingCase(name, tableCase), mode: 'physical',
    ...(f.schema.trim() ? { schema: f.schema.trim() } : {}),
    ...(description ? { description } : {}), ...(udpValues ? { udpValues } : {}),
  };
}
