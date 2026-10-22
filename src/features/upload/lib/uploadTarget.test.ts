// Proyecto destino de la carga: helpers puros del popup.
import { describe, it, expect } from 'vitest';
import type { UploadTargets } from '../upload.service';
import { needsTarget, pickTarget, targetHint } from './uploadTarget';

const c = (id: string, name: string): UploadTargets['candidates'][number] => ({ id, name, folders: 1, canvases: 0 });
const NONE: UploadTargets = { mode: 'none', candidates: [] };
const AUTO: UploadTargets = { mode: 'auto', candidates: [c('f1', 'Modelo Fisico')] };
const CHOOSE: UploadTargets = { mode: 'choose', candidates: [c('c', 'COMERCIAL'), c('o', 'Otros')] };

describe('needsTarget', () => {
  it('solo exige destino con 2+ proyectos internos', () => {
    expect(needsTarget(null)).toBe(false);
    expect(needsTarget(NONE)).toBe(false);
    expect(needsTarget(AUTO)).toBe(false);
    expect(needsTarget(CHOOSE)).toBe(true);
  });
});

describe('pickTarget', () => {
  it('en choose: el actual si sigue siendo candidato, luego el recordado, si no nada (nunca adivina)', () => {
    expect(pickTarget(CHOOSE, 'o', 'c')).toBe('c');
    expect(pickTarget(CHOOSE, 'o', 'zz')).toBe('o');
    expect(pickTarget(CHOOSE, 'zz', null)).toBeNull();
    expect(pickTarget(CHOOSE, null, null)).toBeNull();
  });
  it('fuera de choose no hay destino que elegir', () => {
    expect(pickTarget(AUTO, 'f1', 'f1')).toBeNull();
    expect(pickTarget(NONE, 'x', 'x')).toBeNull();
    expect(pickTarget(null, 'x', 'x')).toBeNull();
  });
});

describe('targetHint', () => {
  it('solo en auto, nombrando la única raíz', () => {
    expect(targetHint(AUTO)).toBe('Subjects and diagrams will be created under “Modelo Fisico”');
    expect(targetHint(CHOOSE)).toBeNull();
    expect(targetHint(NONE)).toBeNull();
    expect(targetHint(null)).toBeNull();
  });
});
