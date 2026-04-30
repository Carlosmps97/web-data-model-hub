'use client';

/**
 * A thin, draggable vertical handle used to resize the workbench's left
 * panel (Visual / Code tabs). Renders as a 4-px hairline that sits against
 * the right edge of the panel; widens and lights up on hover.
 *
 * The handle derives its position from a single numeric state in the UI
 * store (`leftPanelWidth`) which is also persisted in `localStorage`, so
 * the user's preferred panel width survives reloads.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useUIStore } from '@/store/useUIStore';

interface LeftPanelResizerProps {
  /**
   * Optional override for the minimum allowed width. If not provided, the
   * store's internal clamp (`LEFT_PANEL_MIN`, currently 220px) applies.
   */
  min?: number;
  /** Optional override for the maximum allowed width. */
  max?: number;
}

export default function LeftPanelResizer({ min, max }: LeftPanelResizerProps) {
  const setLeftPanelWidth = useUIStore((s) => s.setLeftPanelWidth);

  // Keep the active drag's bookkeeping + the installed DOM listeners on
  // refs so we can (a) tear down cleanly on unmount without creating
  // mutually-dependent useCallback values, and (b) read always-fresh
  // min/max overrides without re-installing listeners on every re-render.
  const dragRef = useRef<{ startX: number; startWidth: number; active: boolean }>({
    startX: 0,
    startWidth: 0,
    active: false,
  });
  const moveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    const move = moveHandlerRef.current;
    const up = upHandlerRef.current;
    if (move) document.removeEventListener('mousemove', move);
    if (up) document.removeEventListener('mouseup', up);
    moveHandlerRef.current = null;
    upHandlerRef.current = null;
    dragRef.current.active = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startWidth: useUIStore.getState().leftPanelWidth,
      active: true,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = ev.clientX - dragRef.current.startX;
      let next = dragRef.current.startWidth + delta;
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
      setLeftPanelWidth(next);
    };

    const onUp = () => cleanup();

    moveHandlerRef.current = onMove;
    upHandlerRef.current = onUp;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [cleanup, setLeftPanelWidth, min, max]);

  // Defensive cleanup if the component unmounts while dragging
  useEffect(() => cleanup, [cleanup]);

  return (
    <div
      className="left-panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize left panel"
      onMouseDown={onMouseDown}
      title="Drag to resize"
    />
  );
}
