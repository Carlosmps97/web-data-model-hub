/**
 * Barrel de servicios.
 *
 * Permite importar con `import { listProjects } from '@/services'` sin
 * acoplar al consumidor al archivo físico. Sólo reexporta; no ejecuta
 * código al importarse.
 */

export * from './http';
export * as projectsService from './projects.service';
export * as modelsService from './models.service';
export * as agentService from './agent.service';
export { authService } from './auth.service';
export { adminService } from './admin.service';
