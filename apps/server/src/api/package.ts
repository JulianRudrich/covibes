import type { DB } from '@covibes/db';
import {
  buildCodingPackage,
  codingPackageSummary,
  codingPackageTexts,
  exportFileName,
  PACKAGE_TEXT_KINDS,
  packageTextInputSchema,
  packageTextKindSchema,
  projectIdSchema,
  type CodingPackageInput,
  type CodingPackageOverview,
  type PackageTexts,
} from '@covibes/shared';
import { strToU8, zipSync } from 'fflate';
import { Hono } from 'hono';
import type { Transaction } from 'kysely';

import { loadDecisions } from '@server/api/decisions';
import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { loadAssignees } from '@server/plan/assignees';

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

type Documents = Pick<BoardDocuments, 'readBoard' | 'readPlan'>;

/**
 * What a project holds right now, as the package is built from it; undefined for someone who is
 * no member. The plan and the boards are read as they stand, also while people have them open.
 */
async function gather(
  db: AppDb,
  documents: Documents,
  projectId: string,
  userId: string,
): Promise<{ input: CodingPackageInput; canEdit: boolean } | undefined> {
  const stored = await withUser(db, userId, async (trx) => {
    const member = await membership(trx, projectId, userId);
    if (!member) return undefined;
    const project = await trx
      .selectFrom('projects')
      .select(['name', 'language'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    const boards = await trx
      .selectFrom('boards')
      .select(['id', 'title'])
      .where('project_id', '=', projectId)
      .orderBy('kind', 'desc') // 'main' before 'extra'
      .orderBy('position')
      .orderBy('created_at')
      .execute();
    const criteria = await trx
      .selectFrom('criteria')
      .select('text')
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const texts = await trx
      .selectFrom('package_texts')
      .select(['kind', 'content'])
      .where('project_id', '=', projectId)
      .execute();
    return {
      role: member.role,
      project,
      boards,
      criteria,
      texts,
      decisions: await loadDecisions(trx, projectId),
      assignees: await loadAssignees(trx, projectId),
    };
  });
  if (!stored) return undefined;

  const plan = await documents.readPlan(projectId);
  const boards: CodingPackageInput['boards'][number][] = [];
  // One after the other: a board nobody has open is read from the database.
  for (const board of stored.boards) {
    boards.push({ title: board.title, ...(await documents.readBoard(board.id)) });
  }
  const texts: PackageTexts = { code_standards: '', ui_direction: '' };
  for (const kind of PACKAGE_TEXT_KINDS) {
    texts[kind] = stored.texts.find((text) => text.kind === kind)?.content ?? '';
  }
  return {
    canEdit: stored.role !== 'viewer',
    input: {
      projectName: stored.project.name,
      language: stored.project.language === 'en' ? 'en' : 'de',
      date: new Date(),
      plan,
      assignees: new Map(
        [...stored.assignees].map(([taskId, assignee]) => [taskId, assignee.name]),
      ),
      decisions: stored.decisions,
      criteria: stored.criteria.map((criterion) => criterion.text),
      boards,
      texts,
    },
  };
}

/**
 * `/api/projects/:projectId/package` (spec 27b): the package for coding agents. Members see what
 * it holds and download it as a ZIP; owners and editors write the two texts the plan does not
 * hold. The package is built from the project as it stands, without a model.
 */
export function packageRoutes(db: AppDb, auth: Auth, documents: Documents) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const project = await gather(db, documents, projectId.data, user.id);
    if (!project) return apiError(c, 'not_found');
    return c.json<CodingPackageOverview>({
      ...codingPackageSummary(project.input),
      language: project.input.language,
      texts: project.input.texts,
      canEdit: project.canEdit,
    });
  });

  /** Stores one of the team's texts; an empty one removes it. The database checks who may. */
  routes.put('/texts/:kind', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const kind = packageTextKindSchema.safeParse(c.req.param('kind'));
    if (!projectId.success || !kind.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = packageTextInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    try {
      const outcome = await withUser(db, user.id, async (trx) => {
        const member = await membership(trx, projectId.data, user.id);
        if (!member) return 'not_found' as const;
        // Removing a text as a viewer changes nothing and raises nothing, so it is said here.
        if (member.role === 'viewer') return 'forbidden' as const;
        if (input.data.content === '') {
          await trx
            .deleteFrom('package_texts')
            .where('project_id', '=', projectId.data)
            .where('kind', '=', kind.data)
            .execute();
          return 'done' as const;
        }
        await trx
          .insertInto('package_texts')
          .values({
            project_id: projectId.data,
            kind: kind.data,
            content: input.data.content,
            updated_by: user.id,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['project_id', 'kind'])
              .doUpdateSet({ content: input.data.content, updated_by: user.id }),
          )
          .execute();
        return 'done' as const;
      });
      if (outcome !== 'done') return apiError(c, outcome);
      return c.body(null, 204);
    } catch (error) {
      if (sqlState(error) === '42501') return apiError(c, 'forbidden');
      throw error;
    }
  });

  /** The package as a ZIP, with its files at the top, named after the project. */
  routes.get('/download', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const project = await gather(db, documents, projectId.data, user.id);
    if (!project) return apiError(c, 'not_found');
    const files = buildCodingPackage(project.input);
    // Without a plan there is no package.
    if (files.length === 0) return apiError(c, 'not_found');

    const zip = zipSync(
      Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])),
      { level: 6, mtime: project.input.date },
    );
    const { language, projectName } = project.input;
    const name = exportFileName(projectName, codingPackageTexts(language).fileName);
    return c.body(new Uint8Array(zip), 200, {
      'content-type': 'application/zip',
      // The name holds lowercase letters, digits and hyphens only.
      'content-disposition': `attachment; filename="${name}.zip"`,
      'cache-control': 'no-store',
    });
  });

  return routes;
}
