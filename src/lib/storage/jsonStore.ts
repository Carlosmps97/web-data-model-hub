// Local JSON file storage service
// Provides CRUD operations for projects and models using the local filesystem.
// Designed with an abstraction-friendly interface for future migration to SharePoint or Cosmos DB.

import fs from 'fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { PATHS } from './paths';
import type { Project, DataModel } from '@/types/model';

// Ensure data directories exist on first use
function ensureDataDirs() {
  if (!existsSync(PATHS.dataDir)) {
    mkdirSync(PATHS.dataDir, { recursive: true });
  }
  if (!existsSync(PATHS.modelsDir)) {
    mkdirSync(PATHS.modelsDir, { recursive: true });
  }
  if (!existsSync(PATHS.projectsFile)) {
    writeFileSync(PATHS.projectsFile, JSON.stringify([], null, 2), 'utf-8');
  }
}

// --- Projects ---

export async function getProjects(): Promise<Project[]> {
  ensureDataDirs();
  const raw = await fs.readFile(PATHS.projectsFile, 'utf-8');
  return JSON.parse(raw) as Project[];
}

export async function getProject(id: string): Promise<Project | null> {
  const projects = await getProjects();
  return projects.find((p) => p.id === id) || null;
}

export async function createProject(project: Project): Promise<Project> {
  const projects = await getProjects();
  projects.push(project);
  await fs.writeFile(PATHS.projectsFile, JSON.stringify(projects, null, 2), 'utf-8');
  return project;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
  const projects = await getProjects();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return null;
  projects[index] = { ...projects[index], ...updates, updatedAt: new Date().toISOString() };
  await fs.writeFile(PATHS.projectsFile, JSON.stringify(projects, null, 2), 'utf-8');
  return projects[index];
}

export async function deleteProject(id: string): Promise<boolean> {
  const projects = await getProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  await fs.writeFile(PATHS.projectsFile, JSON.stringify(filtered, null, 2), 'utf-8');

  // Also delete all models belonging to this project
  const models = await getModels();
  const projectModels = models.filter((m) => m.projectId === id);
  for (const model of projectModels) {
    await deleteModel(model.id);
  }
  return true;
}

// --- Models ---

export async function getModels(projectId?: string): Promise<DataModel[]> {
  ensureDataDirs();
  const dir = await fs.readdir(PATHS.modelsDir);
  const jsonFiles = dir.filter((f) => f.endsWith('.json'));
  const models: DataModel[] = [];

  for (const file of jsonFiles) {
    const raw = await fs.readFile(`${PATHS.modelsDir}/${file}`, 'utf-8');
    const model = JSON.parse(raw) as DataModel;
    if (!projectId || model.projectId === projectId) {
      models.push(model);
    }
  }

  return models;
}

export async function getModel(id: string): Promise<DataModel | null> {
  ensureDataDirs();
  const filePath = PATHS.modelFile(id);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as DataModel;
  } catch {
    return null;
  }
}

export async function createModel(model: DataModel): Promise<DataModel> {
  ensureDataDirs();
  const filePath = PATHS.modelFile(model.id);
  await fs.writeFile(filePath, JSON.stringify(model, null, 2), 'utf-8');
  return model;
}

export async function updateModel(id: string, updates: Partial<DataModel>): Promise<DataModel | null> {
  const existing = await getModel(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await fs.writeFile(PATHS.modelFile(id), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export async function deleteModel(id: string): Promise<boolean> {
  const filePath = PATHS.modelFile(id);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
