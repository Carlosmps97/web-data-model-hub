/**
 * Primitivas de UI del sistema de diseño. Se importan desde `@/components/ui`.
 * Solo tema claro, navy; estilos en styles/components.css.
 *
 * Algunas primitivas (Modal, ConfirmDialog, Tooltip, Icon, TagEditor) conservan
 * su propio export por defecto; Tooltip, Modal y ConfirmDialog también se
 * reexportan aquí por comodidad.
 */

export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { default as Dialog } from './Dialog';
export type { DialogProps, DialogBackdrop } from './Dialog';

export { default as Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { default as Avatar } from './Avatar';
export type { AvatarProps, AvatarTone } from './Avatar';

export { default as SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl';

// Primitivas con export por defecto propio.
export { default as Tooltip } from './Tooltip';
export { default as Modal } from './Modal';
export { default as ConfirmDialog } from './ConfirmDialog';

// Lista de afectados compartida (virtualizada, con buscador).
export { default as AffectedTable } from './AffectedTable';
export type { AffectedColumn, AffectedTableProps } from './AffectedTable';
