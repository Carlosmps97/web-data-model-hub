import { describe, expect, it } from 'vitest';
import type { Theme } from '@/lib/colors';
import { NEW_THEME_COLOR, themeChanged, themeEditInput, themeFormError, themeFormOf } from './themeForm';

const T: Theme = { id: 'th1', name: 'Entidad Principal', color: '#FFFF80', order: 0 };

describe('themeForm (doc 109)', () => {
  it('alta: nombre vacío y el color por defecto de Erwin', () => {
    expect(themeFormOf(null)).toEqual({ name: '', color: NEW_THEME_COLOR });
    expect(themeFormOf(T)).toEqual({ name: 'Entidad Principal', color: '#FFFF80' });
  });

  it('valida nombre (obligatorio, largo, único sin mayúsculas) y color #RRGGBB', () => {
    expect(themeFormError({ name: '  ', color: '#FFFFFF' }, [])).toMatch(/needs a name/);
    expect(themeFormError({ name: 'x'.repeat(81), color: '#FFFFFF' }, [])).toMatch(/80/);
    expect(themeFormError({ name: ' entidad principal ', color: '#FFFFFF' }, [T])).toMatch(/already/);
    expect(themeFormError({ name: 'Secundaria', color: 'FFC080' }, [T])).toMatch(/#FFC080/);
    expect(themeFormError({ name: 'Secundaria', color: '#ffc080' }, [T])).toBeNull();
  });

  it('sin cambios reales no hay nada que aplicar (mayúsculas del hex y espacios no cuentan)', () => {
    expect(themeChanged({ name: 'Entidad Principal ', color: '#ffff80' }, T)).toBe(false);
    expect(themeChanged({ name: 'Entidad', color: '#FFFF80' }, T)).toBe(true);
    expect(themeChanged({ name: 'Entidad Principal', color: '#FFFF81' }, T)).toBe(true);
    expect(themeChanged({ name: 'Nuevo', color: '#FFFF80' }, null)).toBe(true);
  });

  it('el upsert lleva el id al editar (el orden lo conserva el backend); sin id en un alta', () => {
    expect(themeEditInput({ name: ' Entidad ', color: '#ffff80' }, T)).toEqual({ id: 'th1', name: 'Entidad', color: '#FFFF80' });
    expect(themeEditInput({ name: 'Nuevo', color: '#c0c0c0' }, null)).toEqual({ name: 'Nuevo', color: '#C0C0C0' });
  });
});
