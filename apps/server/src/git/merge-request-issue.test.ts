import { describe, expect, it } from 'vitest';

import { issueOfMergeRequest } from '@server/git/merge-request-issue';

// Which issue a merge request belongs to (spec 30b).
const CREATED = new Set([4, 5, 12]);
const of = (sourceBranch: string, title = 'Login', description = '') =>
  issueOfMergeRequest({ sourceBranch, title, description }, CREATED);

describe('issueOfMergeRequest', () => {
  it('reads the issue from a branch that is named after it', () => {
    expect(of('12-login-per-link')).toBe(12);
    expect(of('4-x')).toBe(4);
    // The branch names an issue Covibes did not create.
    expect(of('7-etwas-anderes')).toBeNull();
    // A number alone, or one further back, is no issue's branch.
    expect(of('12')).toBeNull();
    expect(of('feature/12-login')).toBeNull();
    expect(of('v12-login')).toBeNull();
  });

  it('reads it from the title or the description, as people and GitLab write it', () => {
    expect(of('feature/login', 'Login per Link (#5)')).toBe(5);
    expect(of('feature/login', 'Login', 'Closes #12\n\nBaut den Login.')).toBe(12);
    expect(of('feature/login', 'Login', 'Siehe #7 und #4.')).toBe(4);
    expect(of('feature/login', 'Login', 'Teil von (#5).')).toBe(5);
  });

  it('prefers the branch, then the title, then the description', () => {
    expect(of('4-login', 'Login #5', 'Closes #12')).toBe(4);
    expect(of('feature/login', 'Login #5', 'Closes #12')).toBe(5);
  });

  it('takes nothing that only looks like an issue', () => {
    // A merge request ("!5"), an anchor of an address, a number inside a word, a heading.
    expect(of('feature/login', 'Folgt auf !5')).toBeNull();
    expect(of('feature/login', 'Login', 'https://example.com/seite#5')).toBeNull();
    expect(of('feature/login', 'Login', 'Farbe abc#5 und #5a')).toBeNull();
    expect(of('feature/login', 'Login', '## 5 Schritte')).toBeNull();
    expect(of('feature/login', 'Login', 'Nummer #123456789012')).toBeNull();
  });

  it('finds nothing without issues of Covibes', () => {
    expect(
      issueOfMergeRequest(
        { sourceBranch: '4-login', title: '#4', description: 'Closes #4' },
        new Set(),
      ),
    ).toBeNull();
  });
});
