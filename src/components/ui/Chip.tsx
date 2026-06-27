import React from 'react';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Render the chip in an "active/selected" state (blue tint). */
  active?: boolean;
  /** Slightly smaller padding. */
  small?: boolean;
}

/**
 * Chip — lightly-bordered rounded chip used for context filters / project tags
 * (e.g. project chips on version rows, the Projects filter row on Home).
 * Active state = blue tint fill + blue text.
 */
export default function Chip({ active = false, small = false, className, children, ...rest }: ChipProps) {
  const cls = ['dmh-chip', active ? 'is-active' : '', small ? 'dmh-chip--sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
