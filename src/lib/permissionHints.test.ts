import { describe, expect, it } from 'vitest';
import { newProjectBlock } from './permissionHints';

describe('crear proyectos', () => {
  it('exige model.edit', () => {
    expect(newProjectBlock({ permissions: { 'model.view': true } })).toContain('model.edit');
    expect(newProjectBlock({ permissions: { 'model.edit': true } })).toBeNull();
  });
  it('quien tiene proyectos asignados no crea proyectos, salvo el administrador', () => {
    expect(newProjectBlock({ permissions: { 'model.edit': true }, projectIds: ['p1'] })).toContain('assigned');
    expect(newProjectBlock({ permissions: { 'model.edit': true, 'admin.manage': true }, projectIds: ['p1'] })).toBeNull();
  });
  it('sin usuario no bloquea (la sesión la exige el login)', () => {
    expect(newProjectBlock(null)).toBeNull();
  });
});
