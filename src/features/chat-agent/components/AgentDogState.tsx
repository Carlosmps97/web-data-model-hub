'use client';

/* eslint-disable react-hooks/set-state-in-effect --
   This mascot is a timed animation state machine (think ↔ search → answer/error)
   driven by the `sending` transition. The synchronous resets at the top of each
   effect are intentional and behavior-correct; the rest of the state changes
   happen inside timer callbacks. Refactoring would regress the animation. */

import React, { useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

type DogPhase = 'thinking' | 'searching' | 'answering' | 'error';

interface PhaseConfig {
  src: string;
  label: string;
  animClass: string;
}

const PHASES: Record<DogPhase, PhaseConfig> = {
  thinking:  { src: '/think.png',   label: 'Pensando en el modelo…',      animClass: 'dog-anim-think'  },
  searching: { src: '/search.png',  label: 'Revisando lineamientos…',      animClass: 'dog-anim-search' },
  answering: { src: '/answer.png',  label: '¡Modelo listo!',               animClass: 'dog-anim-answer' },
  error:     { src: '/error.png',   label: 'Algo salió mal',               animClass: 'dog-anim-error'  },
};

// Labels alternativos para la fase de búsqueda (se muestran al ciclar)
const SEARCH_LABELS = [
  'Revisando lineamientos…',
  'Consultando el catálogo…',
  'Verificando tipos de dato…',
];

const THINK_LABELS = [
  'Pensando en el modelo…',
  'Elaborando la estructura…',
  'Procesando la solicitud…',
];

// ─── Props ────────────────────────────────────────────────────────────────

export interface AgentDogStateProps {
  /** Pipeline en vuelo */
  sending: boolean;
  /** El último mensaje del asistente tuvo error */
  hasError: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────

export function AgentDogState({ sending, hasError }: AgentDogStateProps) {
  const [phase, setPhase]         = useState<DogPhase>('thinking');
  const [label, setLabel]         = useState(THINK_LABELS[0]);
  const [fading, setFading]       = useState(false);   // true = fade-out en curso
  const [visible, setVisible]     = useState(false);
  const prevSendingRef            = useRef(false);
  const thinkIdxRef               = useRef(0);
  const searchIdxRef              = useRef(0);

  // ── Mientras sending: cicla think ↔ search ──────────────────────────
  useEffect(() => {
    if (!sending) return;

    setVisible(true);
    setFading(false);
    setPhase('thinking');
    setLabel(THINK_LABELS[0]);
    thinkIdxRef.current  = 0;
    searchIdxRef.current = 0;

    let isThinking = true;

    const interval = setInterval(() => {
      // fade out
      setFading(true);

      setTimeout(() => {
        isThinking = !isThinking;

        if (isThinking) {
          const idx = (thinkIdxRef.current + 1) % THINK_LABELS.length;
          thinkIdxRef.current = idx;
          setPhase('thinking');
          setLabel(THINK_LABELS[idx]);
        } else {
          const idx = (searchIdxRef.current + 1) % SEARCH_LABELS.length;
          searchIdxRef.current = idx;
          setPhase('searching');
          setLabel(SEARCH_LABELS[idx]);
        }

        // fade in
        setFading(false);
      }, 320);
    }, 2800);

    return () => clearInterval(interval);
  }, [sending]);

  // ── Cuando sending termina: muestra answer o error ──────────────────
  useEffect(() => {
    const wasSending = prevSendingRef.current;
    prevSendingRef.current = sending;

    if (!wasSending || sending) return; // solo actúa cuando transiciona true→false

    const nextPhase: DogPhase = hasError ? 'error' : 'answering';

    // crossfade
    setFading(true);
    const t1 = setTimeout(() => {
      setPhase(nextPhase);
      setLabel(PHASES[nextPhase].label);
      setFading(false);
    }, 320);

    if (!hasError) {
      // auto-esconde después de mostrar answering
      const t2 = setTimeout(() => {
        setFading(true);
        setTimeout(() => setVisible(false), 350);
      }, 2800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }

    return () => clearTimeout(t1);
  }, [sending, hasError]);

  if (!visible) return null;

  const config = PHASES[phase];

  return (
    <div className={`agent-dog-state ${fading ? 'dog-fading' : 'dog-visible'}`}>
      <div className={`agent-dog-img-wrap ${config.animClass}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={config.src}
          alt=""
          width={92}
          height={92}
          style={{ objectFit: 'contain', display: 'block' }}
        />
      </div>
      <span className={`agent-dog-label agent-dog-label--${phase}`}>
        {label}
      </span>
    </div>
  );
}
