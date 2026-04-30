/**
 * DBML language support for CodeMirror 6.
 *
 * Implements a lightweight `StreamLanguage` tokenizer for DBML (the syntax
 * used by dbdiagram.io) covering comments, strings, keywords, data types,
 * numbers, reference operators and identifiers. A matching `HighlightStyle`
 * provides the colour palette applied via `syntaxHighlighting`.
 *
 * Full DBML grammar reference: https://dbml.dbdiagram.io/docs/
 *
 * Exposed:
 *   - `dbmlLanguage`       — a `LanguageSupport` extension (syntax only).
 *   - `dbmlHighlightStyle` — the default dark highlight style.
 *   - `dbmlDarkTheme`      — an editor chrome theme matching the app palette.
 *   - `dbmlExtensions()`   — convenience factory that returns all of the
 *                             above, ready to plug into `EditorState.create`.
 */

import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

// ── Keyword sets ────────────────────────────────────────────────────────

/** DBML block declarators (case-insensitive). */
const BLOCK_KEYWORDS = new Set([
  'table', 'ref', 'project', 'enum', 'tablegroup', 'note', 'indexes', 'as',
]);

/** Column-level attributes and modifiers. */
const ATTR_KEYWORDS = new Set([
  'pk', 'primary', 'key', 'unique', 'not', 'null', 'increment',
  'default', 'note', 'ref',
]);

/** Common SQL data types supported by DBML. */
const TYPE_KEYWORDS = new Set([
  // Integer
  'int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint',
  // Decimal
  'decimal', 'numeric', 'float', 'double', 'real', 'money',
  // String
  'varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext',
  'nvarchar', 'nchar', 'string',
  // Bytes
  'blob', 'bytea', 'binary', 'varbinary',
  // Date / Time
  'date', 'datetime', 'timestamp', 'timestamptz', 'time', 'timetz', 'interval',
  // Boolean
  'boolean', 'bool',
  // JSON / Array / UUID / geographic / other
  'json', 'jsonb', 'uuid', 'xml',
  'geography', 'geometry', 'point', 'line', 'polygon',
  'enum', 'array', 'bytes',
]);

/** True/false atoms. */
const BOOL_ATOMS = new Set(['true', 'false', 'null']);

// ── Tokenizer ───────────────────────────────────────────────────────────

/** The tokenizer is fully stateless — `Record<string, never>` expresses
 *  that more precisely than an empty interface (which eslint flags). */
type DBMLState = Record<string, never>;

const dbmlParser: StreamParser<DBMLState> = {
  startState: () => ({}),

  token(stream) {
    // Whitespace
    if (stream.eatSpace()) return null;

    // Line comments: // ...
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Block comments: /* ... */ — single-line fallback
    if (stream.match('/*')) {
      while (!stream.eol()) {
        if (stream.match('*/')) break;
        stream.next();
      }
      return 'comment';
    }

    // Strings
    const ch = stream.peek();
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = stream.next()!;
      let escaped = false;
      while (!stream.eol()) {
        const c = stream.next();
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === quote) return 'string';
      }
      return 'string';
    }

    // Numbers: ints and decimals (incl. leading +/-, scientific notation)
    if (/\d/.test(ch!) || (ch === '.' && /\d/.test(stream.string[stream.pos + 1] ?? ''))) {
      stream.eatWhile(/[\d._eE+-]/);
      return 'number';
    }

    // Reference operators used in DBML: > < - <> inside [ref: ...]
    if (ch === '>' || ch === '<') {
      stream.next();
      return 'operator';
    }

    // Brackets and punctuation
    if (ch && /[{}\[\]()]/.test(ch)) {
      stream.next();
      return 'bracket';
    }

    if (ch === ',' || ch === ';' || ch === ':' || ch === '.') {
      stream.next();
      return 'punctuation';
    }

    // Identifiers / keywords
    if (ch && /[A-Za-z_]/.test(ch)) {
      stream.eatWhile(/[A-Za-z0-9_]/);
      const word = stream.current().toLowerCase();

      if (BLOCK_KEYWORDS.has(word)) return 'keyword';
      if (ATTR_KEYWORDS.has(word))  return 'attribute';
      if (TYPE_KEYWORDS.has(word))  return 'type';
      if (BOOL_ATOMS.has(word))     return 'atom';

      // Detect whether this identifier appears immediately after a block
      // keyword (Table X, Ref Y, Enum Z) to paint it as a declaration name.
      // Poor-man's lookback: peek at the previous non-whitespace word on
      // this line by re-scanning the line text. Cheap since DBML lines are
      // short.
      const lineStart = stream.string.slice(0, stream.start).trimEnd();
      if (/\btable$/i.test(lineStart) || /\bref$/i.test(lineStart) ||
          /\benum$/i.test(lineStart) || /\bproject$/i.test(lineStart) ||
          /\btablegroup$/i.test(lineStart)) {
        return 'typeName';
      }

      return 'variableName';
    }

    // Unknown char — advance
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '//' },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] },
  },
};

// ── Map custom token names to Lezer tags ────────────────────────────────

const streamLang = StreamLanguage.define<DBMLState>({
  ...dbmlParser,
  tokenTable: {
    comment:      t.lineComment,
    string:       t.string,
    number:       t.number,
    keyword:      t.keyword,
    attribute:    t.attributeName,
    type:         t.typeName,
    atom:         t.atom,
    operator:     t.operator,
    bracket:      t.bracket,
    punctuation:  t.punctuation,
    typeName:     t.className,
    variableName: t.variableName,
  },
});

export const dbmlLanguage = new LanguageSupport(streamLang);

// ── Highlight palette — inspired by dbdiagram.io's dark theme ────────────

export const dbmlHighlightStyle = HighlightStyle.define([
  { tag: t.lineComment,    color: '#6c7086', fontStyle: 'italic' },
  { tag: t.string,         color: '#a6e3a1' },
  { tag: t.number,         color: '#f9e2af' },
  { tag: t.keyword,        color: '#cba6f7', fontWeight: '600' },
  { tag: t.attributeName,  color: '#89b4fa' },
  { tag: t.typeName,       color: '#94e2d5' },
  { tag: t.className,      color: '#f5c2e7', fontWeight: '600' },
  { tag: t.atom,           color: '#fab387' },
  { tag: t.operator,       color: '#f38ba8' },
  { tag: t.bracket,        color: '#cdd6f4' },
  { tag: t.punctuation,    color: '#a6adc8' },
  { tag: t.variableName,   color: '#cdd6f4' },
]);

// ── Chrome theme (gutter, cursor, selection) ────────────────────────────

export const dbmlDarkTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: '#cdd6f4',
    backgroundColor: '#1e1e2e',
    fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-content': {
    caretColor: '#f5e0dc',
    padding: '10px 0',
    lineHeight: '1.6',
  },
  '.cm-line': {
    padding: '0 12px 0 4px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#f5e0dc',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(137, 180, 250, 0.22)',
  },
  '.cm-gutters': {
    backgroundColor: '#181825',
    color: '#585b70',
    border: 'none',
    borderRight: '1px solid rgba(255,255,255,0.05)',
    fontSize: '12px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(137, 180, 250, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(137, 180, 250, 0.08)',
    color: '#cdd6f4',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6c7086',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 10px',
    minWidth: '22px',
  },
}, { dark: true });

/** Bundle of extensions that together form the DBML editor look. */
export function dbmlExtensions() {
  return [
    dbmlLanguage,
    syntaxHighlighting(dbmlHighlightStyle),
    dbmlDarkTheme,
  ];
}
