/**
 * CodeEditor — editor de plantillas Jinja de las reglas del Export DDL
 * (CodeMirror 6): resaltado de Jinja, números de línea, deshacer/rehacer, Tab
 * que indenta y autocompletado con los datos de las reglas, las piezas y las
 * variables (dentro de `{{ }}` / `{% %}`, o en todo el campo si es una
 * expresión, como el «cuándo») y, dentro de `udp['…']`, los UDP físicos del
 * proyecto. `singleLine` = una sola línea (el «cuándo» o el nombre de un archivo).
 */
import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { autocompletion, completionKeymap, type CompletionContext } from '@codemirror/autocomplete';

import type { RuleCompletion } from '../ddlRuleReference';

const JINJA = StreamLanguage.define(jinja2);

const THEME = EditorView.theme({
  '&': { fontSize: '12.5px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: '9px' },
  '&.cm-focused': { outline: 'none', borderColor: '#2E5BFF', boxShadow: '0 0 0 3px rgba(46,91,255,0.12)' },
  '.cm-content': { fontFamily: 'var(--mono, monospace)', padding: '6px 0' },
  '.cm-gutters': { background: '#F7F9FC', color: '#9AA3B2', border: 'none', borderRadius: '9px 0 0 9px' },
  '.cm-scroller': { overflow: 'auto', maxHeight: '520px' },
  '&.cm-editor[data-readonly="true"]': { background: '#F7F9FC' },
});

/** ¿El texto antes del cursor deja abierto un `{{` o un `{%`? Puro. */
export function insideJinja(before: string): boolean {
  const open = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'));
  return open >= 0 && Math.max(before.lastIndexOf('}}'), before.lastIndexOf('%}')) < open;
}

/** `udp[` antes del cursor: la comilla ya tipeada y lo escrito del nombre. Puro. */
export function udpContext(before: string): { quote: string; partial: string } | null {
  const m = /udp\[\s*(['"]?)([^'"\]]*)$/.exec(before);
  return m ? { quote: m[1], partial: m[2] } : null;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Una sola línea: sin saltos (un salto pegado pasa a espacio) ni números de línea. */
  singleLine?: boolean;
  /** Todo el campo es una expresión Jinja (el «cuándo»): autocompleta en todo el texto. */
  expression?: boolean;
  /** Alto mínimo del área de texto (multilínea). */
  minHeight?: number;
  completions?: RuleCompletion[];
  /** UDP físicos del proyecto: se ofrecen dentro de `udp['…']`. */
  udpNames?: string[];
  placeholder?: string;
  ariaLabel?: string;
}

export default function CodeEditor({
  value, onChange, readOnly = false, singleLine = false, expression = false, minHeight = 120, completions = [],
  udpNames = [], placeholder, ariaLabel,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const placeholderSlot = useRef(new Compartment());
  const historySlot = useRef(new Compartment());
  // Lo último de cada prop, para los callbacks del editor (se crea una vez).
  const latest = useRef({ onChange, completions, udpNames, placeholder });
  latest.current = { onChange, completions, udpNames, placeholder };

  useEffect(() => {
    if (!host.current) return;
    const complete = (ctx: CompletionContext) => {
      if (!expression && !insideJinja(ctx.state.sliceDoc(0, ctx.pos))) return null;
      const udp = udpContext(ctx.state.sliceDoc(ctx.state.doc.lineAt(ctx.pos).from, ctx.pos));
      if (udp) {
        const q = udp.quote || "'";
        return {
          from: ctx.pos - udp.partial.length,
          options: latest.current.udpNames.map((n) => ({ label: n, apply: `${udp.quote ? '' : q}${n}${q}]`, type: 'property' })),
          validFor: /^[^'"\]]*$/,
        };
      }
      const word = ctx.matchBefore(/[A-Za-z_][\w.]*$/);
      if (!word && !ctx.explicit) return null;
      return {
        from: word ? word.from : ctx.pos,
        options: latest.current.completions.map((c) => ({ label: c.label, detail: c.detail, apply: c.apply, type: 'variable' })),
        validFor: /^[\w.]*$/,
      };
    };
    // Una sola línea: un salto pegado (o que llega de afuera) pasa a espacio.
    const oneLine = EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
      const text = tr.newDoc.toString().replace(/\n/g, ' ');
      return {
        changes: { from: 0, to: tr.startState.doc.length, insert: text },
        selection: { anchor: Math.min(tr.newSelection.main.head, text.length) },
        ...(tr.annotation(Transaction.addToHistory) === false ? { annotations: Transaction.addToHistory.of(false) } : {}),
      };
    });
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...(singleLine ? [oneLine]
          : [lineNumbers(), highlightActiveLine(), EditorView.theme({ '.cm-content, .cm-gutter': { minHeight: `${minHeight}px` } })]),
        historySlot.current.of(history()),
        drawSelection(),
        bracketMatching(),
        JINJA,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [complete] }),
        keymap.of([
          ...completionKeymap,
          ...(singleLine ? [{ key: 'Enter', run: () => true }] : [indentWithTab]),
          ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Code', ...(singleLine ? { 'aria-multiline': 'false' } : {}) }),
        EditorView.editorAttributes.of({ 'data-readonly': String(readOnly) }),
        placeholderSlot.current.of(latest.current.placeholder ? cmPlaceholder(latest.current.placeholder) : []),
        EditorView.updateListener.of((u) => { if (u.docChanged) latest.current.onChange(u.state.doc.toString()); }),
        THEME,
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // El texto entra al crear; los cambios de afuera los aplica el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, singleLine, expression, minHeight, ariaLabel]);

  // El placeholder cambia sin recrear el editor (se conserva el historial).
  useEffect(() => {
    view.current?.dispatch({ effects: placeholderSlot.current.reconfigure(placeholder ? cmPlaceholder(placeholder) : []) });
  }, [placeholder]);

  // Un valor que cambia desde afuera reemplaza el texto con un historial nuevo
  // (deshacer nunca trae el texto anterior).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false), effects: historySlot.current.reconfigure([]),
      });
      v.dispatch({ effects: historySlot.current.reconfigure(history()) });
    }
  }, [value]);

  return <div ref={host} />;
}
