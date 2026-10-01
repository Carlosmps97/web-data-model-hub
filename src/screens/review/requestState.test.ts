// Doc 88 §6: estado/badge/historial de una solicitud (puros).
import { describe, it, expect } from 'vitest';
import type { ChangesetDetail, RequestCycle } from '@/types/versioning';
import { activityAt, canvasAction, historyOf, isRequest, outcomeOf, REVIEW_CANVAS_DENIED, requestBadge } from './requestState';

const cycle = (n: number, outcome: RequestCycle['outcome'], extra: Partial<RequestCycle> = {}): RequestCycle =>
  ({ id: `r${n}`, cycle: n, reviewers: ['beto'], outcome, ...extra });

describe('outcomeOf / requestBadge', () => {
  it('en revisión, aprobada (publicada o no), rechazada → draft, retirada → draft', () => {
    expect(outcomeOf({ status: 'submitted' })).toBe('pending');
    expect(requestBadge({ status: 'approved', appliedAt: 'x' }).text).toBe('Approved · published');
    expect(requestBadge({ status: 'approved', appliedAt: null }).text).toBe('Approved · publishing');
    expect(requestBadge({ status: 'draft', lastRequest: cycle(1, 'rejected') }).text).toBe('Rejected · back in draft');
    expect(requestBadge({ status: 'draft', lastRequest: cycle(1, 'withdrawn') }).text).toBe('Withdrawn · draft');
    expect(requestBadge({ status: 'rejected' }).text).toBe('Rejected');            // legacy pre-doc 88
    expect(outcomeOf({ status: 'draft' })).toBeNull();
  });
});

describe('isRequest', () => {
  it('toda versión con historial es una solicitud; sin historial, solo las en revisión/decididas no aplicadas', () => {
    expect(isRequest({ status: 'draft', requests: [cycle(1, 'rejected')] })).toBe(true);
    expect(isRequest({ status: 'approved', appliedAt: 'x', requests: [cycle(1, 'approved')] })).toBe(true);
    expect(isRequest({ status: 'draft', requests: [] })).toBe(false);
    expect(isRequest({ status: 'submitted' })).toBe(true);
    expect(isRequest({ status: 'approved', appliedAt: 'x' })).toBe(false);
  });
});

describe('historyOf', () => {
  const base: ChangesetDetail = { id: 'c1', title: 'T', owner: 'ana', projectId: 'p1', reviewers: ['beto'], approvals: {}, comments: [], status: 'draft' };
  it('más reciente primero', () => {
    const d = { ...base, status: 'draft' as const, requests: [cycle(1, 'withdrawn'), cycle(2, 'rejected', { note: 'falta PK' })] };
    expect(historyOf(d).map((c) => c.cycle)).toEqual([2, 1]);
  });
  it('sintetiza el ciclo de un doc legacy rechazado y no inventa nada en un draft', () => {
    const legacy = { ...base, status: 'rejected' as const, reviewedBy: 'beto', reviewNote: 'no', submittedAt: 's' };
    const [c] = historyOf(legacy);
    expect([c.outcome, c.note, c.decidedBy, c.submittedBy]).toEqual(['rejected', 'no', 'beto', 'ana']);
    expect(historyOf({ ...base, status: 'draft' as const })).toEqual([]);
  });
});

describe('activityAt', () => {
  it('prefiere la decisión del último ciclo, luego el envío', () => {
    expect(activityAt({ lastRequest: cycle(1, 'rejected', { decidedAt: '2026-09-11T10:00:00Z', submittedAt: '2026-09-10T10:00:00Z' }) }))
      .toBe(Date.parse('2026-09-11T10:00:00Z'));
    expect(activityAt({ submittedAt: '2026-09-09T10:00:00Z' })).toBe(Date.parse('2026-09-09T10:00:00Z'));
    expect(activityAt({})).toBe(0);
  });
});

/** Doc 105 (U2): «View in canvas» sólo para quien PUEDE abrir el request —
 *  antes cualquiera lo abría y la sesión se degradaba con un aviso. */
describe('canvasAction (doc 105)', () => {
  const none = () => false;
  const admin = (p: string) => p === 'admin.manage';
  const req = { status: 'submitted' as const, owner: 'ana', reviewers: ['beto'] };

  it('un request ajeno sin ser revisor ni admin: deshabilitado con el motivo', () => {
    const a = canvasAction(req, 'carla', none);
    expect(a.enabled).toBe(false);
    expect(a.hint).toBe(REVIEW_CANVAS_DENIED);
  });

  it('dueño, revisor asignado y admin lo abren en solo lectura', () => {
    for (const [me, has] of [['ana', none], ['beto', none], ['dev', admin]] as const) {
      const a = canvasAction(req, me, has);
      expect(a.enabled).toBe(true);
      expect(a.mode).toBe('readonly');
      expect(a.label).toBe('View in canvas');
    }
  });

  it('el draft propio se abre para editar; un request cerrado no se abre', () => {
    const own = canvasAction({ status: 'draft', owner: 'ana', reviewers: [] }, 'ana', none);
    expect([own.enabled, own.mode, own.label]).toEqual([true, 'editing', 'Open in canvas']);
    expect(canvasAction({ status: 'approved', owner: 'ana', reviewers: ['beto'], appliedAt: 'x' }, 'beto', none).enabled)
      .toBe(false);
  });
});
