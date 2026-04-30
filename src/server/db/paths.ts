// File path constants for local JSON storage
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

export const PATHS = {
  dataDir: path.resolve(DATA_DIR),
  projectsFile: path.resolve(DATA_DIR, 'projects.json'),
  modelsDir: path.resolve(DATA_DIR, 'models'),
  modelFile: (id: string) => path.resolve(DATA_DIR, 'models', `${id}.json`),
};
