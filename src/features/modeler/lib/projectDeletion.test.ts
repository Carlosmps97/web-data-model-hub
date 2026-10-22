import { describe, it, expect } from 'vitest';
import { criticalDeletionText, deletionSummary, nameMatches } from './projectDeletion';

const COUNTS = { tables: 2113, columns: 96004, views: 1902, relationships: 3410, schemas: 388, folders: 12, canvases: 275 };

describe('projectDeletion', () => {
  it('resume los conteos con separador de miles y el nombre entre comillas', () => {
    const s = deletionSummary('Modelo Ventas', COUNTS);
    // Los conteos son de producción; al aprobar, la cascada borra además lo que
    // la working copy agregó (se aplica primero), y el texto lo indica.
    expect(s).toBe('This working copy will delete project «Modelo Ventas» and everything in it: 2,113 tables, 96,004 columns, 1,902 views, 3,410 relationships, 388 schemas, 12 folders and 275 canvases in production (plus anything this working copy adds), and its Data Standards.');
  });

  it('el nombre debe coincidir exactamente (sin espacios sobrantes)', () => {
    expect(nameMatches('  Modelo Ventas ', 'Modelo Ventas')).toBe(true);
    expect(nameMatches('modelo ventas', 'Modelo Ventas')).toBe(false);
    expect(nameMatches('', 'Modelo Ventas')).toBe(false);
  });

  it('criticalDeletionText nombra el proyecto, los conteos y la irreversibilidad', () => {
    const t = criticalDeletionText('Modelo Ventas', COUNTS);
    expect(t.title).toBe('Critical: this request deletes project «Modelo Ventas».');
    expect(t.body).toBe("Approving it removes 2,113 tables, 96,004 columns, 1,902 views, 3,410 relationships, 388 schemas, 12 folders and 275 canvases (as published today, plus anything this request adds) from the platform, together with the project's Data Standards. This cannot be undone from the web.");
  });
});

describe('singular (nunca «1 folders»)', () => {
  it('cada conteo de 1 va en singular', () => {
    const one = { tables: 1, columns: 1, views: 1, relationships: 1, schemas: 1, folders: 1, canvases: 1 };
    expect(deletionSummary('P', one)).toContain('1 table, 1 column, 1 view, 1 relationship, 1 schema, 1 folder and 1 canvas in production');
  });
});
