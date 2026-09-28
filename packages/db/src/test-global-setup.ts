import type { TestProject } from 'vitest/node';

import { startTestDatabase } from './testing';

declare module 'vitest' {
  export interface ProvidedContext {
    database: { adminUrl: string; appUrl: string };
  }
}

export default async function setup(project: TestProject) {
  const database = await startTestDatabase();
  project.provide('database', { adminUrl: database.adminUrl, appUrl: database.appUrl });
  return async () => {
    await database.stop();
  };
}
