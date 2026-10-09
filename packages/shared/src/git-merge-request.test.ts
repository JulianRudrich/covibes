import { describe, expect, it } from 'vitest';

import type { PackageFile } from './coding-package';
import {
  buildMergeRequestActions,
  CREATE_ONLY_PATHS,
  mergeRequestBranch,
  packageBytes,
  STALE_SPEC_PATTERN,
} from './git-merge-request';
import {
  gitActionDraftSchema,
  gitCommitPayloadSchema,
  gitFileSchema,
  MAX_GIT_FILES,
} from './git-requests';

const FILES: PackageFile[] = [
  { path: 'CLAUDE.md', content: '# Vereins-App\n' },
  { path: 'AGENTS.md', content: '# Vereins-App\n' },
  { path: 'context/project-overview.md', content: '# Übersicht\n' },
  { path: 'context/progress-tracker.md', content: '# Fortschritt\n' },
  { path: 'context/feature-specs/00-overview.md', content: '# Specs\n' },
  { path: 'context/feature-specs/01-01-projekt-aufsetzen.md', content: '# 01-01\n' },
  { path: 'context/feature-specs/01-02-login-per-link.md', content: '# 01-02\n' },
  { path: 'docs/diagrams/haupt-canvas.md', content: '# Haupt-Canvas\n' },
];

const BRANCH = 'covibes/plan-2026-10-09-a1b2c3';

function build(overrides: Partial<Parameters<typeof buildMergeRequestActions>[0]> = {}) {
  return buildMergeRequestActions({
    projectName: 'Vereins-App',
    language: 'de',
    files: FILES,
    branch: BRANCH,
    targetBranch: 'main',
    ...overrides,
  });
}

describe('mergeRequestBranch', () => {
  it('names the branch by the day and a mark', () => {
    expect(mergeRequestBranch(new Date('2026-10-09T23:30:00Z'), 'a1b2c3')).toBe(BRANCH);
  });
});

describe('buildMergeRequestActions', () => {
  it('gives the commit of all files on the branch, then the merge request into the target', () => {
    const [commit, mergeRequest, ...more] = build();

    expect(more).toEqual([]);
    expect(commit?.kind).toBe('commit');
    expect(mergeRequest?.kind).toBe('merge_request');
    if (commit?.kind !== 'commit' || mergeRequest?.kind !== 'merge_request') return;
    expect(commit.payload).toMatchObject({
      title: `Plan-Paket auf dem Branch ${BRANCH} (8 Dateien)`,
      branch: BRANCH,
      startBranch: 'main',
      message:
        'Projektplan, Feature-Specs und Diagramme aus Covibes\n\nAngelegt via Covibes aus dem Projektplan von „Vereins-App“.',
    });
    expect(commit.payload.files.map((file) => file.path)).toEqual(FILES.map((file) => file.path));
    expect(commit.payload.files[0]).toEqual({
      path: 'CLAUDE.md',
      content: '# Vereins-App\n',
      mode: 'write',
    });
    expect(mergeRequest.payload).toMatchObject({
      title: 'Projektplan, Feature-Specs und Diagramme aus Covibes',
      sourceBranch: BRANCH,
      targetBranch: 'main',
    });
    // Both are actions the server takes.
    expect(gitActionDraftSchema.safeParse(commit).success).toBe(true);
    expect(gitActionDraftSchema.safeParse(mergeRequest).success).toBe(true);
  });

  it('only adds the progress tracker when it is missing, and writes every other file', () => {
    const [commit] = build();
    if (commit?.kind !== 'commit') throw new Error('The commit is missing');

    expect(CREATE_ONLY_PATHS).toEqual(['context/progress-tracker.md']);
    expect(commit.payload.files.filter((file) => file.mode === 'create')).toEqual([
      { path: 'context/progress-tracker.md', content: '# Fortschritt\n', mode: 'create' },
    ]);
  });

  it('describes what the package holds, and ends with "via Covibes"', () => {
    const [, mergeRequest] = build();
    if (mergeRequest?.kind !== 'merge_request') throw new Error('The merge request is missing');

    expect(mergeRequest.payload.description).toBe(
      [
        'Das Plan-Paket von „Vereins-App“, wie das Team es in Covibes geplant hat:',
        '',
        '- `CLAUDE.md` und `AGENTS.md`: der Einstieg für Coding-Agents',
        '- `context/`: Projektübersicht, Architektur, Entscheidungen, Code-Standards, UI-Richtung, Projektplan und Fortschritt',
        '- `context/feature-specs/`: 2 Feature-Specs',
        '- `docs/diagrams/`: 1 Datei mit Diagrammen',
        '',
        'Dateien, die es im Repository schon gab, erscheinen hier als Änderung. `context/progress-tracker.md` wird nur angelegt, wenn sie fehlt.',
        '',
        '---',
        '',
        '*Angelegt via Covibes aus dem Projektplan von „Vereins-App“.*',
      ].join('\n'),
    );
  });

  it('names feature specs of an earlier package, and leaves out what the package does not have', () => {
    const [commit, mergeRequest] = build({
      language: 'en',
      projectName: 'Club *App*',
      files: FILES.filter(
        (file) => !file.path.startsWith('docs/') && !STALE_SPEC_PATTERN.test(file.path),
      ),
      stale: ['context/feature-specs/01-03-alt.md', 'context/feature-specs/02-01-weg.md'],
    });
    if (commit?.kind !== 'commit' || mergeRequest?.kind !== 'merge_request') {
      throw new Error('The actions are missing');
    }

    expect(commit.payload.title).toBe(`Plan package on the branch ${BRANCH} (5 files)`);
    expect(commit.payload.message).toBe(
      'Project plan, feature specs and diagrams from Covibes\n\nCreated via Covibes from the project plan of "Club \\*App\\*".',
    );
    const { description } = mergeRequest.payload;
    expect(description).toContain('The plan package of "Club \\*App\\*"');
    expect(description).not.toContain('feature-specs/`:');
    expect(description).not.toContain('docs/diagrams');
    expect(description).toContain(
      '**No longer in the package** (feature specs of an earlier state; remove them by hand if needed):\n- `context/feature-specs/01-03-alt.md`\n- `context/feature-specs/02-01-weg.md`',
    );
    expect(
      description.endsWith('*Created via Covibes from the project plan of "Club \\*App\\*".*'),
    ).toBe(true);
  });

  it('gives nothing without files', () => {
    expect(build({ files: [] })).toEqual([]);
  });
});

describe('the files of a commit', () => {
  it('have a path inside the repository', () => {
    const file = (path: string) => gitFileSchema.safeParse({ path, content: '', mode: 'write' });

    expect(file('CLAUDE.md').success).toBe(true);
    expect(file('context/feature-specs/01-01-a.md').success).toBe(true);
    for (const path of [
      '',
      '/etc/passwd',
      '../outside.md',
      'a/../b.md',
      'a//b.md',
      './a.md',
      'a\\b.md',
      'a/',
    ]) {
      expect(file(path).success, path).toBe(false);
    }
    expect(gitFileSchema.safeParse({ path: 'a.md', content: '', mode: 'delete' }).success).toBe(
      false,
    );
  });

  it('are counted and weighed', () => {
    const commit = {
      title: 'x',
      branch: BRANCH,
      startBranch: 'main',
      message: 'x',
      files: Array.from({ length: MAX_GIT_FILES + 1 }, (_, index) => ({
        path: `f${String(index)}.md`,
        content: '',
        mode: 'write',
      })),
    };

    expect(gitCommitPayloadSchema.safeParse(commit).success).toBe(false);
    expect(
      gitCommitPayloadSchema.safeParse({ ...commit, files: commit.files.slice(1) }).success,
    ).toBe(true);
    expect(gitCommitPayloadSchema.safeParse({ ...commit, files: [] }).success).toBe(false);
    // Bytes, not characters: an umlaut weighs two.
    expect(packageBytes([{ content: 'aä' }, { content: '€' }])).toBe(6);
    expect(packageBytes([])).toBe(0);
  });

  it('knows a feature spec of the package by its name', () => {
    expect(STALE_SPEC_PATTERN.test('context/feature-specs/01-02-login.md')).toBe(true);
    expect(STALE_SPEC_PATTERN.test('context/feature-specs/00-overview.md')).toBe(false);
    expect(STALE_SPEC_PATTERN.test('context/feature-specs/notes.md')).toBe(false);
    expect(STALE_SPEC_PATTERN.test('context/feature-specs/01-02/deep.md')).toBe(false);
    expect(STALE_SPEC_PATTERN.test('docs/01-02-login.md')).toBe(false);
  });
});
