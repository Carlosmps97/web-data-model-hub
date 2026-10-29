// Guardas de la selección por área (doc 134 §3.2) que ninguna otra prueba ve sin
// DOM: el cuadro es de la app (React Flow da por «dentro» a lo no dibujado y marca
// relaciones), los nodos no toman foco (las flechas moverían sin grabar), lo que
// React Flow cambia vuelve al grupo, y el cuadro empieza en la burbuja del
// `mousedown` (así el escudo del doble clic, en captura, lo ataja).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvas = readFileSync(join(__dirname, 'ModelerCanvas.tsx'), 'utf8');
const hook = readFileSync(join(__dirname, 'useBoxSelect.ts'), 'utf8');
const tableNode = readFileSync(join(__dirname, 'TableNode.tsx'), 'utf8');

describe('selección por área en el canvas', () => {
  it('el cuadro de React Flow apagado y los nodos sin foco de teclado', () => {
    expect(canvas).toContain('selectionKeyCode={null}');
    expect(canvas).not.toMatch(/selectionOnDrag/);
    expect(canvas).toContain('nodesFocusable={false}');
  });
  it('la selección de React Flow vuelve al grupo de la app y el botón vive en los controles', () => {
    expect(canvas).toContain('onSelectionChange=');
    expect(canvas).toContain('setGroup(selectedTables(sel), { fromFlow: true })');
    expect(canvas).toMatch(/<Controls><SelectAreaButton \/><\/Controls>/);
  });
  // React Flow vuelve a avisar su selección cada vez que cambia la identidad del
  // callback (es dependencia de su efecto): inline, cada render del canvas
  // avisaría la selección vieja y borraría el grupo recién elegido.
  it('el aviso de la selección de React Flow es estable', () => {
    expect(canvas).toMatch(/const onFlowSelection = useCallback\(/);
    expect(canvas).toContain('onSelectionChange={onFlowSelection}');
  });
  // Sin grupo, el anillo es solo el de la tabla seleccionada (la que React Flow
  // marca al empezar a arrastrarla no lo lleva); con grupo, el de las del grupo.
  it('el anillo de la tabla: la seleccionada o, con grupo, las del grupo', () => {
    expect(tableNode).toContain('const selected = single || (groupActive && !!flowSelected);');
  });
  // Una regla, un estado (§3.2): lo que React Flow tiene seleccionado lo deriva un
  // solo efecto del grupo o de la tabla seleccionada, y Ctrl/Cmd + clic lo calcula
  // la app (React Flow lee su selección tarde: la suya llega con el próximo render).
  it('la selección de React Flow sale de la app en un solo efecto; Ctrl/Cmd + clic lo calcula la app', () => {
    expect(canvas).toContain('applySelection(prev, group, selectedTableId)');
    expect(canvas).toMatch(/\}, \[selectedTableId, freshGens, groupSeq, setNodes\]\);/);
    expect(canvas).not.toMatch(/applyGroup/);
    expect(canvas).toContain('toggleGroup(st.groupIds, st.selectedTableId, node.id)');
  });
  // Con el candado puesto no hay cuadro: el fondo vuelve a moverse con el botón principal.
  it('con el candado, el modo no le quita el arrastre al fondo', () => {
    expect(canvas).toContain('const boxGesture = !canvasLocked && (boxSelect || shiftDown);');
    expect(canvas).toContain('panOnDrag={boxGesture ? [1] : true}');
  });
  it('el cuadro empieza en la burbuja del mousedown', () => {
    expect(hook).toMatch(/el\.addEventListener\('mousedown', down\);/);
    expect(hook).not.toMatch(/addEventListener\('mousedown', down, true\)/);
  });
});
