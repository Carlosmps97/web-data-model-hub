import React from 'react';

export type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color tone (soft tint bg + colored text). */
  tone?: BadgeTone;
}

/**
 * Badge — small squared-radius label (counts, kinds like PK/FK/partition,
 * UDP word-type prime/class/modifier). Smaller + less round than Pill.
 */
export default function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const cls = ['dmh-badge', `dmh-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
