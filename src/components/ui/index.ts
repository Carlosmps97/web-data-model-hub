/**
 * Design-system UI primitives (DMH-Erwin v20260625-2). Import from
 * `@/components/ui`. Light-only, navy; styled via styles/components.css.
 *
 * Existing primitives (Modal, ConfirmDialog, Tooltip, Icon, TagEditor) keep
 * their own default exports and are re-exported here for convenience.
 */

export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { default as Dialog } from './Dialog';
export type { DialogProps, DialogBackdrop } from './Dialog';

export { default as Pill } from './Pill';
export type { PillProps, PillTone } from './Pill';

export { default as Chip } from './Chip';
export type { ChipProps } from './Chip';

export { default as Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { default as Avatar } from './Avatar';
export type { AvatarProps, AvatarTone } from './Avatar';

export { default as SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl';

// Reused existing primitives.
export { default as Tooltip } from './Tooltip';
export { default as Modal } from './Modal';
export { default as ConfirmDialog, shouldSkipConfirm, clearSkipConfirm } from './ConfirmDialog';
