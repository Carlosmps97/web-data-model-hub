// Opciones de un UDP que se elige.
import { describe, expect, it } from 'vitest';
import { udpChoices } from './udpChoices';

describe('udpChoices', () => {
  it('booleano: true y false; lista: sus valores', () => {
    expect(udpChoices({ dataType: 'boolean', allowedValues: [] }, '')).toEqual(['true', 'false']);
    expect(udpChoices({ dataType: 'list', allowedValues: ['DAC', 'No DAC'] }, 'DAC')).toEqual(['DAC', 'No DAC']);
  });

  it('un valor guardado fuera de las opciones se sigue viendo (al final)', () => {
    expect(udpChoices({ dataType: 'boolean', allowedValues: [] }, 'Sí')).toEqual(['true', 'false', 'Sí']);
    expect(udpChoices({ dataType: 'list', allowedValues: ['DAC'] }, 'Retirado')).toEqual(['DAC', 'Retirado']);
  });
});
