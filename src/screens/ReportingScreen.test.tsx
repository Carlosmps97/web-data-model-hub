// Combos Project / Version y estados de la grilla del Reporting (markup estático, sin DOM).
// Doc 105 (B9): el combo Version no tenía nombre accesible (un lector de
// pantalla leía «edit text, Production · v12»). Doc 105 (B3): durante un
// export quedaban habilitados — cambiar de versión no cortaba el export, que
// terminaba y bajaba el archivo de la versión anterior.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VersionRow } from '@/types/versioning';
import { MoreTablesError, ProjectPick, TablesLoadError, VersionPick } from './ReportingScreen';

const projects = [{ id: 'p1', name: 'MODELO DDV' }, { id: 'p2', name: 'RDV' }];
const draft: VersionRow = {
  id: 'cs1', versionLabel: 'v14', title: 'Carga Excel', owner: 'ana', status: 'draft', projectId: 'p1',
  deletesProject: false, reviewers: [],
};
/** Atributos del <input> del combo (el menú no se renderiza cerrado). */
const inputOf = (html: string) => /<input[^>]*>/.exec(html)?.[0] ?? '';

describe('combos del Reporting', () => {
  it('Project y Version tienen nombre accesible en su input', () => {
    const project = renderToStaticMarkup(<ProjectPick projects={projects} projectId="p1" onPick={() => {}} />);
    expect(inputOf(project)).toContain('aria-label="Project"');
    expect(inputOf(project)).toContain('value="MODELO DDV"');
    const version = renderToStaticMarkup(<VersionPick production={null} own={[draft]} versionId="cs1" onPick={() => {}} />);
    expect(inputOf(version)).toContain('aria-label="Version"');
    expect(inputOf(version)).toContain('value="v14 · Carga Excel — draft"');
  });

  it('durante un export quedan deshabilitados y dicen por qué', () => {
    const project = renderToStaticMarkup(<ProjectPick projects={projects} projectId="p1" onPick={() => {}} busy />);
    const version = renderToStaticMarkup(<VersionPick production={null} own={[draft]} versionId={null} onPick={() => {}} busy />);
    for (const html of [project, version]) {
      expect(inputOf(html)).toMatch(/\sdisabled=""/);
      expect(html).toContain('title="Wait for the export to finish"');
    }
  });

  // Doc 105 (revisión, a11y): el motivo estaba sólo en `title` (del contenedor):
  // un lector de pantalla no lo leía. Ahora el input lo describe
  // (`aria-describedby`) sin cambiar su nombre accesible, «Project» / «Version».
  it('el motivo es la descripción accesible del input; el nombre sigue siendo «Project» / «Version»', () => {
    const cases: [string, string][] = [
      ['Project', renderToStaticMarkup(<ProjectPick projects={projects} projectId="p1" onPick={() => {}} busy />)],
      ['Version', renderToStaticMarkup(<VersionPick production={null} own={[draft]} versionId={null} onPick={() => {}} busy />)],
    ];
    for (const [name, html] of cases) {
      const id = /aria-describedby="([^"]+)"/.exec(inputOf(html))?.[1];
      expect(id, name).toBeTruthy();
      const described = new RegExp(`<[^>]*\\sid="${id!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)<`).exec(html)?.[1];
      expect(described).toBe('Wait for the export to finish');
      expect(inputOf(html)).toContain(`aria-label="${name}"`);
    }
    const idle = renderToStaticMarkup(<VersionPick production={null} own={[draft]} versionId={null} onPick={() => {}} />);
    expect(inputOf(idle)).not.toContain('aria-describedby');
    expect(idle).not.toContain('Wait for the export to finish');
  });

  it('sin export en curso siguen habilitados, con su ayuda de siempre', () => {
    const project = renderToStaticMarkup(<ProjectPick projects={projects} projectId="p1" onPick={() => {}} />);
    const version = renderToStaticMarkup(<VersionPick production={null} own={[]} versionId={null} onPick={() => {}} />);
    expect(inputOf(project)).not.toMatch(/\sdisabled/);
    expect(inputOf(version)).not.toMatch(/\sdisabled/);
    expect(project).toContain('title="Project"');
    expect(version).toContain('title="Version — production or one of your unpublished versions"');
  });
});

// Doc 105 (R2-B4): si la carga de tablas fallaba, la grilla decía «No tables to
// report yet» (como un proyecto vacío). El reintento lo cablea la pantalla.
describe('grilla del Reporting', () => {
  it('una carga fallida dice que falló y ofrece Retry', () => {
    const html = renderToStaticMarkup(<TablesLoadError onRetry={() => {}} />);
    expect(html).toMatch(/Couldn(&#x27;|')t load the tables/);
    expect(html).toMatch(/<button[^>]*>(<[^>]+>)*Retry/);
    expect(html).not.toContain('No tables to report yet');
  });
  it('una página siguiente fallida lo dice al pie, con Retry', () => {
    const html = renderToStaticMarkup(<MoreTablesError onRetry={() => {}} />);
    expect(html).toMatch(/Couldn(&#x27;|')t load more tables/);
    expect(html).toMatch(/<button[^>]*>(<[^>]+>)*Retry/);
  });
});
