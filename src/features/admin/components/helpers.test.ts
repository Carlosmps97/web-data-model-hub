import { describe, expect, it } from 'vitest';
import type { AdminUser, Role } from '../admin.service';
import { activeAdminIds, isOnlyAdmin, matrixLeavesNoAdmin, matrixSaveOrder, projectScopeLabel } from './helpers';

const role = (id: string, admin: boolean): Role => ({ id, name: id, permissions: { 'model.view': true, 'admin.manage': admin } });
const user = (id: string, roleId: string, status = 'active', projectIds: string[] = []): AdminUser =>
  ({ id, email: id, name: id, role: roleId, status, projectIds });

const ROLES = [role('administrador', true), role('lector', false)];

describe('regla de al menos un administrador activo', () => {
  it('cuenta solo administradores no deshabilitados', () => {
    const users = [user('a', 'administrador'), user('b', 'administrador', 'disabled'), user('c', 'lector')];
    expect(activeAdminIds(users, ROLES)).toEqual(['a']);
    expect(isOnlyAdmin('a', users, ROLES)).toBe(true);
    expect(isOnlyAdmin('c', users, ROLES)).toBe(false);
  });

  it('con dos administradores ninguno es el único', () => {
    const users = [user('a', 'administrador'), user('b', 'administrador')];
    expect(isOnlyAdmin('a', users, ROLES)).toBe(false);
  });

  it('la matriz guarda primero el rol que gana admin.manage y al final el de quien guarda', () => {
    const draft = [role('administrador', false), role('lector', false), role('modelador', true)];
    expect(matrixSaveOrder(draft, 'administrador').map((r) => r.id)).toEqual(['modelador', 'lector', 'administrador']);
    expect(matrixSaveOrder(draft, null).map((r) => r.id)).toEqual(['modelador', 'administrador', 'lector']);
  });

  it('la matriz no puede quitar admin.manage a todos los administradores', () => {
    const users = [user('a', 'administrador'), user('c', 'lector')];
    expect(matrixLeavesNoAdmin([role('administrador', false), role('lector', false)], users)).toBe(true);
    expect(matrixLeavesNoAdmin([role('administrador', false), role('lector', true)], users)).toBe(false);
  });
});

describe('alcance por proyecto', () => {
  const live = new Set(['p1', 'p2']);
  it('lista vacía es todos los proyectos', () => {
    expect(projectScopeLabel([], live)).toBe('All projects');
    expect(projectScopeLabel(undefined, live)).toBe('All projects');
  });
  it('cuenta solo los proyectos vigentes', () => {
    expect(projectScopeLabel(['p1'], live)).toBe('1 project');
    expect(projectScopeLabel(['p1', 'p2', 'borrado'], live)).toBe('2 projects');
    expect(projectScopeLabel(['borrado'], live)).toBe('0 projects');
  });
});
