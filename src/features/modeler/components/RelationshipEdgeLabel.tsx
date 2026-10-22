import { EdgeLabelRenderer } from '@xyflow/react';
import type { LabelPlacement } from '../lib/relationshipLabel';

/**
 * Etiqueta de una relación sobre su wire; la comparten el wire crow's-foot y
 * la rama de subcategoría. Va en la capa HTML de etiquetas de React Flow:
 * encima de todos los wires (ninguno la tacha) y debajo de los bloques. Sus
 * gestos (hover, clic, doble clic) burbujean por el árbol de
 * React hasta el wire que la dibuja, así que se comporta como él sin handlers
 * propios. `nodrag nopan`: el doble clic no hace zoom del canvas.
 *
 * `editing`: el wire tiene a la vista los tiradores de su trazo. La
 * etiqueta se vuelve translúcida (deja ver el wire y los tiradores, que suelen
 * caer justo en el punto medio) pero sigue en su sitio y sigue respondiendo:
 * un doble clic sobre ella abre el popup igual que siempre.
 */
export default function RelationshipEdgeLabel({ text, title, at, active, editing = false }: {
  text: string;
  /** Texto completo; solo se usa de tooltip si el dibujo se cortó. */
  title?: string | null;
  at: LabelPlacement;
  /** Resaltada; la atenuación la aplica la clase del canvas (`.wk-canvas--hover`). */
  active: boolean;
  editing?: boolean;
}) {
  return (
    <EdgeLabelRenderer>
      <div
        className={`wk-rel-label nodrag nopan${active ? ' on' : ''}${editing ? ' edit' : ''}`}
        style={{
          transform: `translate(-50%, ${at.anchor === 'bottom' ? '-100%' : '-50%'}) translate(${at.x}px, ${at.y}px)`,
          maxWidth: at.maxWidth,
        }}
        title={title && title !== text ? title : undefined}
      >
        {text}
      </div>
    </EdgeLabelRenderer>
  );
}
