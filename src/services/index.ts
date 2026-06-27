/**
 * Barrel de servicios.
 *
 * Permite importar con `import { listProjects } from '@/services'` sin
 * acoplar al consumidor al archivo físico. Sólo reexporta; no ejecuta
 * código al importarse.
 */

export * from './http';
export * as projectsService from './projects.service';
export * as canvasService from './canvas.service';
export * as metadataService from './metadata.service';
export * as dashboardService from './dashboard.service';
export * as versioningService from './versioning.service';
export * as viewsService from './views.service';
export * as reportingService from './reporting.service';
