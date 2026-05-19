'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Docs sidebar (left panel) with scroll-spy.
//
// Responsibilities:
//   1. Render the grouped index of topics from `NAV`.
//   2. Track which section is currently in view as the user scrolls.
//   3. On click, smooth-scroll to the target section AND update the URL hash.
//   4. Keep the active item visible inside the sidebar's own scrollport when
//      the index is taller than the viewport.
//
// Design notes:
//   - Active detection uses `getBoundingClientRect().top` against a "trigger
//     line" 20% from the top of the viewport. This is more predictable than
//     `IntersectionObserver` because it correctly handles the bottom-of-page
//     edge case (no section is intersecting the trigger band).
//   - Scroll handler is throttled with `requestAnimationFrame` so we never
//     run more than once per repaint.
//   - On mount we honour `location.hash` so deep-link URLs (e.g.
//     `/docs#guidelines`) land on the right item.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NAV, NAV_GROUPS, type SectionId } from './nav';

const TRIGGER_RATIO = 0.2; // 20% from the top of the viewport

export function DocsSidebar() {
  const [active, setActive] = useState<SectionId>(NAV[0].id);
  const itemRefs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});

  // ── Scroll-spy ───────────────────────────────────────────────────────────
  const updateActive = useCallback(() => {
    const trigger = window.innerHeight * TRIGGER_RATIO;
    let next: SectionId = NAV[0].id;
    for (const item of NAV) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      // The last section whose top has passed the trigger line is the active one.
      if (el.getBoundingClientRect().top - trigger <= 0) {
        next = item.id;
      } else {
        break;
      }
    }
    setActive((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateActive);
    };
    // Initial sync (after the layout has settled).
    updateActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [updateActive]);

  // ── Honour deep-link hash on mount ───────────────────────────────────────
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '') as SectionId;
    if (hash && NAV.some((n) => n.id === hash)) {
      // Defer one frame so the section nodes have mounted.
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ block: 'start' });
        setActive(hash);
      });
    }
  }, []);

  // ── Auto-scroll active item into view inside the sidebar ─────────────────
  useEffect(() => {
    const el = itemRefs.current[active];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  // ── Click handler: smooth-scroll + update hash ───────────────────────────
  const handleClick = useCallback((id: SectionId) => {
    setActive(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Reflect the destination in the URL without triggering navigation.
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  return (
    <nav
      aria-label="Índice de documentación"
      style={{
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        // Hide the scrollbar visually but keep it functional.
        scrollbarWidth: 'thin',
        scrollbarColor: '#cbd5e1 transparent',
      }}
    >
      {NAV_GROUPS.map((group) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#94a3b8',
              marginBottom: 4,
              padding: '0 10px',
            }}
          >
            {group}
          </div>
          {NAV.filter((n) => n.group === group).map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[item.id] = el;
                }}
                type="button"
                onClick={() => handleClick(item.id)}
                aria-current={isActive ? 'true' : undefined}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#4f46e5' : '#475569',
                  background: isActive ? '#eef2ff' : 'transparent',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
