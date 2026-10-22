import React from 'react';

export type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tono de color (fondo con tinte suave + texto de color). */
  tone?: BadgeTone;
}

/**
 * Badge: etiqueta pequeña de esquinas poco redondeadas (conteos, tipos como
 * PK/FK/partición). Más pequeña y menos redonda que Pill.
 */
export default function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const cls = ['dmh-badge', `dmh-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
