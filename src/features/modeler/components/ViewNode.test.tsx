// Nodo VISTA del canvas (doc 105, ronda 5): la UI va en inglés — una vista sin
// columnas decía «Sin columnas» (el nodo de tabla ya decía «No columns»).
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { View } from '@/services/views.service';
import ViewNode from './ViewNode';

const view = { id: 'v1', name: 'VW_VACIA', columns: [], sources: [] } as unknown as View;
const render = () => renderToStaticMarkup(
  <ReactFlowProvider>
    <ViewNode {...({ id: 'v1', data: { view, sourceTables: [], colTypes: {}, onEdit: () => {} }, selected: false } as unknown as NodeProps)} />
  </ReactFlowProvider>,
);

describe('vista sin columnas', () => {
  it('dice «No columns»', () => {
    const html = render();
    expect(html).toContain('No columns');
    expect(html).not.toContain('Sin columnas');
  });
});
