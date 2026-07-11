import { describe, it, expect } from 'vitest';
import { ApiError, apiErrorMessage, isConflictError } from './http';

describe('apiErrorMessage', () => {
  it('propaga el detail del backend (ApiError conserva el detail como message)', () => {
    expect(apiErrorMessage(new ApiError('Ya existe la tabla core.CLIENTE', 409), 'fallback'))
      .toBe('Ya existe la tabla core.CLIENTE');
  });

  it('cae al fallback con errores sin mensaje o valores no-Error', () => {
    expect(apiErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(apiErrorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('isConflictError', () => {
  it('true sólo para ApiError con status 409', () => {
    expect(isConflictError(new ApiError('dup', 409))).toBe(true);
    expect(isConflictError(new ApiError('forbidden', 403))).toBe(false);
    expect(isConflictError(new Error('x'))).toBe(false);
  });
});
