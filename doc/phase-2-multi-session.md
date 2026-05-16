# Phase 2 — Multi-session optimistic persistence

Status: **frontend portion landed in this PR. Backend coordination
deferred to a follow-up PR.**

This document tracks what has shipped on the frontend so far and what
the backend team needs to land for the full "last-write-wins" multi-
session contract to hold.

---

## Why a phased rollout

The task contract (Phase 2 brief) lists three frentes: ELK Worker,
Viewport Virtualization, and Multi-Session Optimistic. Frente C — the
multi-session piece — requires coordinated changes across the
frontend store and the Cosmos-backed model service (which lives in a
separate repository). Shipping the frontend changes first lets us:

1. Stop the Save button from clobbering remote position drags
   immediately, even before the backend is fully aligned (positions
   are owned by the dedicated `PATCH /positions` endpoint, which
   already exists).
2. Land the `sendBeacon` safety net so unsaved drags survive a tab
   close, regardless of backend.
3. Defer the version / ETag conflict-resolution work to a focused PR
   that touches both repos.

---

## What landed in this PR (frontend only)

### 1. `saveModel` no longer persists positions

`src/store/useModelStore.ts:174-206` strips `position` from every
table and view in the payload sent to `PUT /api/models/{id}`. The
endpoint that owns positions is and stays
`PATCH /api/models/{id}/positions`, called exclusively by
`useLayoutPersistence`.

Contract assumption (verify with backend): the `PUT /api/models/{id}`
handler must treat a missing `position` field as **leave the existing
DB value alone**, NOT as "set to null". If the current implementation
nulls out missing fields, this PR worsens the bug for tables that
arrive without `position` (e.g. brand-new tables typed by the user
before the canvas auto-arranges).

**Action item for backend**: audit the `updateModel` handler in the
service repo. Recommended fix on the backend side: ignore `position`
inside the model PUT entirely (drop the field from the schema), so
the only way to write a position is the dedicated endpoint.

### 2. `sendBeacon` flush on tab close

`src/features/diagram/hooks/useLayoutPersistence.ts:153-200` adds a
`pagehide` + `beforeunload` listener that flushes any pending
debounced PATCH via `navigator.sendBeacon`. Belt-and-suspenders for
the case where the user drags a table and immediately closes the
tab inside the 500ms debounce window.

The beacon hits the same `PATCH /api/models/{id}/positions` URL with
the same JSON shape, so no backend change is needed.

---

## What still needs backend coordination

### A. Optimistic locking on the model PUT (ETag / version)

**Goal**: when tab A and tab B both call `saveModel()`, only the
first one wins; the loser sees a "model was modified, reload?"
dialog instead of silently overwriting the peer.

**Backend changes**:
- Add a `version: number` (or `etag: string`) field to every
  `DataModel` document in Cosmos.
- `GET /api/models/{id}` returns the current version.
- `PUT /api/models/{id}` requires a `If-Match: <version>` header
  (or a `version` field in the body). On mismatch return 409
  with `{ currentVersion: number }`.
- `PATCH /api/models/{id}/positions` does NOT need versioning —
  per-row last-write-wins is fine for positions.

**Frontend changes** (deferred to follow-up PR):
- Store the `version` returned by `loadModel` in `useModelStore`.
- Pass it on every `saveModel` call.
- On 409, show a `ConfirmDialog` with two options:
  - **Reload**: `loadModel(currentModel.id)` and discard local
    structural edits (positions are unaffected because they're
    persisted independently).
  - **Overwrite**: re-fetch the latest version, set it locally,
    re-issue the PUT. This is the "I know what I'm doing" escape
    hatch.

### B. Polling of structural changes (optional UX improvement)

**Goal**: when tab A and tab B have the same model open, A should
get a passive notification "the model was modified by another user"
within ~30s of B's save.

**Backend changes**:
- Add `GET /api/models/{id}/version` returning only
  `{ version: number }`. Cheap query — should hit a single Cosmos
  document by id and project a single field.

**Frontend changes** (deferred):
- Poll every 30s with a backoff when the tab is hidden.
- Also poll on `document.visibilitychange` (tab regains focus).
- On version mismatch, show a non-blocking toast with a "Reload" CTA.

### C. Retry/backoff on `useLayoutPersistence`

The current persistence path swallows errors after one attempt:
`useLayoutPersistence.ts:85-87`. The Phase 2 brief asks for
exponential backoff (1s, 2s, 4s, 8s, capped at 60s) and a "stop
trying" toast after 5 attempts.

**Frontend-only**, but kept out of this PR to keep its scope tight.
Recommended approach when implemented:

- Maintain a queue of failed PATCHes with a `retries` counter and
  `nextAttemptAt` timestamp.
- A single setTimeout schedules the next retry; new drags in the
  meantime add to the queue but don't reset the backoff.
- After 5 consecutive failures, switch `syncState` to `error` and
  surface a toast via the existing `react-hot-toast` setup. The
  next user action (drag, click) re-triggers the queue with a fresh
  backoff cycle.

---

## Acceptance criteria not yet validated

These remain unverified until the backend changes land:

- [ ] Two tabs with the same model open — Save in tab A does NOT
      overwrite a drag persisted by tab B. (Verifiable on the
      frontend now thanks to (1), but only end-to-end once we
      confirm the backend doesn't null out missing positions.)
- [ ] Auto Arrange in tab A does not lose a concurrent drag from
      tab B on a table NOT affected by the Auto Arrange. (Already
      true on the frontend because the bulk PATCH only sends the
      tables it touched. Pending end-to-end verification.)
- [ ] 409 conflict dialog when two tabs Save the same model
      structurally.
- [ ] 30s polling toast when the model version changes.

---

## File index for the next PR

When picking this back up, start with:

- `src/store/useModelStore.ts` — add `version` state, pass on PUT,
  handle 409.
- `src/services/models.service.ts` — add `getVersion(id)`, surface
  the 409 response shape.
- `src/components/ui/ConfirmDialog.tsx` — already exists, reuse for
  the conflict dialog.
- A new `src/features/diagram/hooks/useModelVersionPolling.ts`
  hook for B.
- `src/features/diagram/hooks/useLayoutPersistence.ts` — add the
  retry/backoff queue for C.
