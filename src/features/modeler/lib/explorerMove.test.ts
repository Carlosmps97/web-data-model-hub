// Reglas de mover un canvas o una carpeta dentro del proyecto (doc 134 §4.3):
// nunca dentro de sí misma, nada si ya está ahí y nunca junto a un homónimo del
// mismo tipo (la carga Excel y el Reporting ubican por nombre).
import { describe, expect, it } from 'vitest';
import type { Folder, SubjectArea } from '../services/modeler.service';
import { folderSubtree, moveVerdict, targetLabel } from './explorerMove';

const folder = (id: string, name: string, parentFolderId: string | null = null): Folder =>
  ({ id, projectId: 'p', parentFolderId, name, order: 0 });
const canvas = (id: string, name: string, folderId: string | null = null): SubjectArea =>
  ({ id, projectId: 'p', name, folderId, tableIds: [], layout: {} });

const FOLDERS = [
  folder('F1', 'Riesgos'), folder('F2', 'Dominio A', 'F1'), folder('F3', 'Modelo', 'F2'),
  folder('F4', 'Ventas'), folder('F6', 'Riesgos', 'F4'), folder('F5', 'riesgos'),
];
const CANVASES = [canvas('C1', 'Clientes', 'F1'), canvas('C2', 'clientes '), canvas('C3', 'Ventas'), canvas('C4', 'riesgos')];

const verdict = (kind: 'folder' | 'canvas', id: string, target: string | null) =>
  moveVerdict({ kind, id }, target, FOLDERS, CANVASES);

describe('moveVerdict', () => {
  it('una carpeta no puede ir dentro de sí misma ni de una subcarpeta suya', () => {
    expect(verdict('folder', 'F1', 'F3')).toEqual({ ok: false, reason: 'into-itself', message: "A folder can't be moved inside itself" });
    expect(verdict('folder', 'F1', 'F1')).toEqual({ ok: false, reason: 'into-itself', message: "A folder can't be moved inside itself" });
  });

  it('a su carpeta actual no se mueve', () => {
    expect(verdict('folder', 'F2', 'F1')).toEqual({ ok: false, reason: 'same-place', message: 'Already in this folder' });
    expect(verdict('canvas', 'C2', null)).toEqual({ ok: false, reason: 'same-place', message: 'Already in this folder' });
    expect(verdict('canvas', 'C1', 'F1')).toEqual({ ok: false, reason: 'same-place', message: 'Already in this folder' });
  });

  it('a otra carpeta o a la raíz se puede', () => {
    expect(verdict('folder', 'F3', null)).toEqual({ ok: true });
    expect(verdict('folder', 'F2', 'F4')).toEqual({ ok: true });
    expect(verdict('canvas', 'C1', null)).toEqual({ ok: false, reason: 'name-taken', message: 'A canvas named “Clientes” already exists in “Models”' });
    expect(verdict('canvas', 'C1', 'F4')).toEqual({ ok: true });
  });

  it('no junto a un homónimo del mismo tipo (sin mayúsculas, tildes ni espacios de más)', () => {
    expect(verdict('canvas', 'C2', 'F1')).toEqual({ ok: false, reason: 'name-taken', message: 'A canvas named “clientes” already exists in “Riesgos”' });
    expect(verdict('folder', 'F5', 'F4')).toEqual({ ok: false, reason: 'name-taken', message: 'A folder named “riesgos” already exists in “Ventas”' });
  });

  it('un canvas con el nombre de una carpeta del destino sí entra (tipos distintos)', () => {
    // En «Ventas» está la subcarpeta «Riesgos»: el canvas «riesgos» entra igual.
    expect(verdict('canvas', 'C4', 'F4')).toEqual({ ok: true });
  });

  it('lo que ya no está en la working copy no se mueve', () => {
    expect(verdict('canvas', 'C1', 'nope')).toEqual({ ok: false, reason: 'missing', message: 'This folder is no longer in the working copy.' });
    expect(verdict('canvas', 'nope', 'F1')).toEqual({ ok: false, reason: 'missing', message: 'This canvas is no longer in the working copy.' });
    expect(verdict('folder', 'nope', 'F1')).toEqual({ ok: false, reason: 'missing', message: 'This folder is no longer in the working copy.' });
  });
});

describe('folderSubtree', () => {
  it('la carpeta y todas sus descendientes', () => {
    expect([...folderSubtree(FOLDERS, 'F1')].sort()).toEqual(['F1', 'F2', 'F3']);
    expect([...folderSubtree(FOLDERS, 'F3')]).toEqual(['F3']);
  });
  it('termina aunque los datos tengan un ciclo', () => {
    const loop = [folder('A', 'A', 'B'), folder('B', 'B', 'A')];
    expect([...folderSubtree(loop, 'A')].sort()).toEqual(['A', 'B']);
  });
});

describe('targetLabel', () => {
  it('el nombre de la carpeta o «Models» para la raíz', () => {
    expect(targetLabel('F1', FOLDERS)).toBe('Riesgos');
    expect(targetLabel(null, FOLDERS)).toBe('Models');
  });
});
