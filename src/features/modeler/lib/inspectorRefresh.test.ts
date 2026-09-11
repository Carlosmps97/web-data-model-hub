// Doc 89 §3.6: qué refrescar tras una escritura del inspector — regla
// COMPLEMENTARIA a la del doc 88 §2 (reload() sube explorerTick sólo cuando
// cambia la firma del canvas ACTIVO), nunca ambas cosas.
import { describe, expect, it } from 'vitest';
import { inspectorRefreshPlan } from './inspectorRefresh';

describe('inspectorRefreshPlan', () => {
  it('objeto en el canvas activo → reload (el propio reload sube el tick si la firma cambia)', () => {
    expect(inspectorRefreshPlan({ onActiveCanvas: true, structural: true })).toBe('reload');
    expect(inspectorRefreshPlan({ onActiveCanvas: true, structural: false })).toBe('reload');
  });

  it('fuera del canvas activo (o sin canvas): estructural → bump del Explorer; no estructural → nada', () => {
    expect(inspectorRefreshPlan({ onActiveCanvas: false, structural: true })).toBe('bump');
    expect(inspectorRefreshPlan({ onActiveCanvas: false, structural: false })).toBe('none');
  });
});
