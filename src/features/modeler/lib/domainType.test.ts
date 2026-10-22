import { describe, expect, it } from 'vitest';
import { applyDomainPick } from './domainType';

describe('applyDomainPick · regla dominio→tipo al (re)elegir parent domain', () => {
  it('elegir un dominio sin override previo hereda su default', () => {
    expect(applyDomainPick({
      currentDomainId: '', typeOverridden: false, currentType: 'STRING',
      nextDomainId: 'dom-A', nextDefault: 'BIGINT',
    })).toEqual({ dataType: 'BIGINT', typeOverridden: false });
  });

  it('elegir OTRO dominio con override manual RE-APLICA el default del nuevo', () => {
    expect(applyDomainPick({
      currentDomainId: 'dom-A', typeOverridden: true, currentType: 'DECIMAL(18,2)',
      nextDomainId: 'dom-B', nextDefault: 'DATE',
    })).toEqual({ dataType: 'DATE', typeOverridden: false });
  });

  it('re-elegir el MISMO dominio respeta el override manual', () => {
    expect(applyDomainPick({
      currentDomainId: 'dom-A', typeOverridden: true, currentType: 'DECIMAL(18,2)',
      nextDomainId: 'dom-A', nextDefault: 'BIGINT',
    })).toEqual({ dataType: 'DECIMAL(18,2)', typeOverridden: true });
  });

  it('quitar el dominio conserva el tipo vigente y limpia el override', () => {
    expect(applyDomainPick({
      currentDomainId: 'dom-A', typeOverridden: true, currentType: 'DECIMAL(18,2)',
      nextDomainId: '', nextDefault: undefined,
    })).toEqual({ dataType: 'DECIMAL(18,2)', typeOverridden: false });
  });

  it('dominio sin defaultDataType: el tipo vigente queda y se marca override', () => {
    expect(applyDomainPick({
      currentDomainId: '', typeOverridden: false, currentType: 'STRING',
      nextDomainId: 'dom-X', nextDefault: undefined,
    })).toEqual({ dataType: 'STRING', typeOverridden: true });
  });
});
