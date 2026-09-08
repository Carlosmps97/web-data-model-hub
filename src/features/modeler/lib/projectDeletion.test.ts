import { describe, it, expect } from 'vitest';
import { criticalDeletionText, deletionSummary, nameMatches } from './projectDeletion';

const COUNTS = { tables: 2113, columns: 96004, views: 1902, relationships: 3410, schemas: 388, folders: 12, canvases: 275 };

describe('projectDeletion (doc 75 D5)', () => {
  it('resume los conteos con separador de miles y el nombre entre comillas', () => {
    const s = deletionSummary('Modelo DDV', COUNTS);
    expect(s).toBe('This working copy will delete project «Modelo DDV» and everything in it: 2,113 tables, 96,004 columns, 1,902 views, 3,410 relationships, 388 schemas, 12 folders and 275 canvases, plus its Data Standards.');
  });

  it('el nombre debe coincidir exactamente (sin espacios sobrantes)', () => {
    expect(nameMatches('  Modelo DDV ', 'Modelo DDV')).toBe(true);
    expect(nameMatches('modelo ddv', 'Modelo DDV')).toBe(false);
    expect(nameMatches('', 'Modelo DDV')).toBe(false);
  });

  it('criticalDeletionText nombra el proyecto, los conteos y la irreversibilidad', () => {
    const t = criticalDeletionText('Modelo DDV', COUNTS);
    expect(t.title).toBe('Critical: this request deletes project «Modelo DDV».');
    expect(t.body).toBe("Approving it removes 2,113 tables, 96,004 columns, 1,902 views, 3,410 relationships, 388 schemas, 12 folders and 275 canvases from the platform, together with the project's Data Standards. This cannot be undone from the web.");
  });
});
