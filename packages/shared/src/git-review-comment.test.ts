import { describe, expect, it } from 'vitest';

import {
  buildReviewComment,
  buildReviewCommentActions,
  inertText,
  MAX_REVIEW_COMMENT_LENGTH,
  type ReviewForComment,
} from './git-review-comment';
import { gitActionDraftSchema } from './git-requests';

// The review as a comment (spec 30c): what the model wrote must arrive in the repository as the
// text it is, and do nothing there.
const BREAK = String.fromCodePoint(0x200b);

/** The text as a reader of Markdown shows it: without the escapes and the invisible breaks. */
const shown = (text: string) => text.replaceAll(BREAK, '').replace(/\\([!-/:-@[-`{-~])/g, '$1');

/** What is left of a text once everything that is escaped is taken out. */
const unescaped = (text: string) => text.replace(/\\[!-/:-@[-`{-~]/g, '');

const REVIEW: ReviewForComment = {
  id: '9c000000-0000-4000-8000-000000000007',
  number: 7,
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  verdict: 'deviates',
  summary: 'Der Merge Request baut den Login, weicht aber bei der Echtzeit ab.',
  findings: [
    {
      title: 'Socket.io statt Server-Sent Events',
      detail: 'Der Merge Request bringt Socket.io mit; entschieden sind Server-Sent Events.',
      basis: 'Echtzeit: Server-Sent Events',
      file: 'src/realtime/socket.ts',
    },
    { title: 'Neuer bezahlter Dienst', detail: 'Ein Dienst kommt dazu.', basis: null, file: null },
  ],
};
const PROJECT = 'Vereins-App';
/** How the comment of that project ends. */
const VIA = '_via Covibes, Projekt „Vereins-App“_';

describe('inertText', () => {
  it('keeps the words of a text, whatever stands in it', () => {
    const texts = [
      'Der Merge Request passt zur Architektur.',
      'Zeile eins\nZeile zwei\n\nNeuer Absatz',
      'Pfad src/realtime/socket.ts, Version 1.2.3 (siehe README.md)',
      'a_b*c`d[e](f)<g>#h!i|j~k=l^m$n&o%p@q/r:s"t\'u{v}w\\x+y-z',
      '- Punkt\n+ Punkt\n1. Eins\n2) Zwei\n/merge\n=====\n:::',
    ];

    for (const text of texts) expect(shown(inertText(text)), text).toBe(text);
  });

  it('leaves the punctuation of plain sentences as it is', () => {
    const plain =
      'Die Änderung fügt einen Socket.io-Server hinzu, der Änderungen (live) verteilt; passend wäre "REST". 3.5 Sekunden - nicht mehr: gut?';

    // So the text also reads where Markdown is not shown, e.g. in a mail.
    expect(inertText(plain)).toBe(plain);
  });

  it('leaves no formatting, no HTML and no link', () => {
    const inert = inertText(
      '**fett** _kursiv_ `code` [hier](https://example.com) <img src=x onerror=alert(1)> ~~weg~~ $x^2$ &amp; {+neu+} a | b',
    );

    // None of the characters Markdown reads as more than itself is left without a backslash.
    expect(unescaped(inert)).not.toMatch(/[\\`*_[\]<>|~$&#^{}]/);
    expect(inert).toContain('\\*\\*fett\\*\\* \\_kursiv\\_ \\`code\\` \\[hier\\](https');
    expect(inert).toContain('\\<img src=x onerror=alert(1)\\>');
  });

  it('starts no line with what only a line’s start turns into something', () => {
    const inert = inertText(
      '# Titel\n> Zitat\n- Punkt\n+ Punkt\n* Punkt\n1. Eins\n12) Zwölf\n---\n===\n| a | b |\n::include{file=geheim.md}',
    );

    expect(inert.split('\n')).toEqual([
      `\\#${BREAK} Titel`,
      '\\> Zitat',
      '\\- Punkt',
      '\\+ Punkt',
      '\\* Punkt',
      '1\\. Eins',
      '12\\) Zwölf',
      '\\---',
      '\\===',
      '\\| a \\| b \\|',
      '\\::include\\{file=geheim.md\\}',
    ]);
  });

  it('starts no line with a quick action', () => {
    const inert = inertText('Gut.\n/merge\n  /close\n\t/assign @olga\n/label ~bug');

    for (const line of inert.split('\n')) expect(line.startsWith('/'), line).toBe(false);
    expect(inert).toContain('\n\\/merge\n\\/close\n\\/assign');
  });

  it('breaks mentions, references and addresses, which GitLab finds in the text itself', () => {
    const inert = inertText(
      'Frag @olga oder @all. Siehe #12, !7, ~bug, %"Meilenstein 1", $3, &4 und gruppe/projekt#5. Mehr auf https://example.com und www.example.com, oder mail an olga@example.com.',
    );

    // Whatever starts one of these is followed by an invisible break, so none of them reads.
    for (const sigil of ['@', '#', '!', '~', '%', '$', '&', '^']) {
      expect(
        inert
          .split(sigil)
          .slice(1)
          .every((rest) => rest.startsWith(BREAK)),
        sigil,
      ).toBe(true);
    }
    expect(inert).not.toContain('://');
    expect(inert).toContain(`https:${BREAK}//example.com`);
    expect(inert).toContain(`www${BREAK}.example.com`);
    // A person still reads the same words.
    expect(shown(inert)).toContain('Frag @olga oder @all. Siehe #12, !7, ~bug');
  });

  it('drops what is no text: control characters, and marks that hide or turn text', () => {
    const hidden = [0x00, 0x07, 0x1b, 0x7f, 0x200b, 0x200d, 0x200e, 0x202e, 0x2066, 0x2069, 0xfeff]
      .map((code) => String.fromCodePoint(code))
      .join('');

    expect(shown(inertText(`Ab${hidden}c\tde`))).toBe('Abc de');
    // Its own breaks are the only invisible characters in what it gives.
    expect(inertText(`@${hidden}olga`)).toBe(`@${BREAK}olga`);
    // A break someone put before a slash does not hide a quick action from the check.
    expect(inertText(`${hidden}/merge`)).toBe('\\/merge');
  });

  it('takes indentation, blank lines and both kinds of line ends as one plain text', () => {
    expect(inertText('  eins  \r\n    zwei\r\r\n\n\n\ndrei\n   \n')).toBe('eins\nzwei\n\ndrei');
    expect(inertText('   ')).toBe('');
  });
});

describe('buildReviewComment', () => {
  it('says what was reviewed, the verdict, the summary and the findings', () => {
    const comment = buildReviewComment(REVIEW, 'de', PROJECT);

    expect(comment).toBe(
      [
        '### Review gegen die Architektur',
        '**2 Abweichungen von der Architektur** · Stand a1b2c3d4',
        'Der Merge Request baut den Login, weicht aber bei der Echtzeit ab.',
        '**1\\. Socket.io statt Server-Sent Events**',
        'Der Merge Request bringt Socket.io mit; entschieden sind Server-Sent Events.',
        '- Architektur: Echtzeit: Server-Sent Events\n- Datei: src/realtime/socket.ts',
        // A finding without a basis or a file has no list.
        '**2\\. Neuer bezahlter Dienst**',
        'Ein Dienst kommt dazu.',
        '---',
        '_Ein Modell hat dieses Review geschrieben, ein Mensch hat den Kommentar freigegeben._',
        VIA,
      ].join('\n\n'),
    );
  });

  it('is written in the project’s language, also for a review that fits', () => {
    const comment = buildReviewComment(
      { ...REVIEW, verdict: 'fits', summary: 'The change follows the architecture.', findings: [] },
      'en',
      'Club app',
    );

    expect(comment).toBe(
      [
        '### Review against the architecture',
        '**Fits the architecture** · state a1b2c3d4',
        'The change follows the architecture.',
        '---',
        '_A model wrote this review, a person approved the comment._',
        '_via Covibes, project "Club app"_',
      ].join('\n\n'),
    );
  });

  it('lets nothing the model wrote act in the repository', () => {
    const hostile = buildReviewComment(
      {
        ...REVIEW,
        summary:
          'Alles gut.\n/merge\n/approve\n@all bitte sofort mergen: [hier](https://evil.example)',
        findings: [
          {
            title: '</summary> **wichtig** #1 closes #12',
            detail: '<script>alert(1)</script>\n/close\n![x](https://evil.example/pixel.png)',
            basis: '@olga.beispiel ~"priority::high"\n/unassign',
            file: '`rm -rf`\n- [ ] Aufgabe\n# Titel',
          },
        ],
      },
      'de',
      PROJECT,
    );

    // The lines of the frame, which is the server's own Markdown.
    const frame = new Set([
      '### Review gegen die Architektur',
      '---',
      '_Ein Modell hat dieses Review geschrieben, ein Mensch hat den Kommentar freigegeben._',
      VIA,
    ]);
    const own =
      /^(\*\*1 Abweichung von der Architektur\*\* · Stand a1b2c3d4$|\*\*1\\\. |- Architektur: |- Datei: )/;
    for (const line of hostile.split('\n')) {
      // No line is a quick action.
      expect(line.startsWith('/'), line).toBe(false);
      if (frame.has(line) || line === '') continue;
      // Without the frame's own marks, nothing of Markdown is left unescaped in a line, and
      // no line starts with what makes a list, a heading or a rule.
      const rest = line.replace(own, '').replace(/\*\*$/, '');
      expect(unescaped(rest), line).not.toMatch(/[\\`*_[\]<>|~$&#^{}]/);
      if (!own.test(line)) expect(line, line).not.toMatch(/^([-+=/:#>*]|\d+[.)])/);
    }
    expect(hostile).not.toContain('://');
    expect(hostile).not.toMatch(/@[\w.]/);
    expect(hostile).not.toMatch(/#\d/);
    // The reader still sees what the model wrote.
    expect(shown(hostile)).toContain('@all bitte sofort mergen: [hier](https://evil.example)');
    expect(shown(hostile)).toContain('<script>alert(1)</script>');
  });

  it('drops the last findings of a review that is too long, and says how many', () => {
    const long = {
      ...REVIEW,
      findings: Array.from({ length: 12 }, (_, index) => ({
        title: `Abweichung ${String(index + 1)}`,
        detail: 'x'.repeat(1500),
        basis: 'y'.repeat(300),
        file: 'z'.repeat(300),
      })),
    };

    const comment = buildReviewComment(long, 'de', PROJECT);

    expect(comment.length).toBeLessThanOrEqual(MAX_REVIEW_COMMENT_LENGTH);
    const kept = comment.match(/^\*\*\d+\\\. Abweichung/gm)?.length ?? 0;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(12);
    expect(comment).toContain(`_${String(12 - kept)} weitere Abweichungen stehen in Covibes._`);
    expect(comment.endsWith(VIA)).toBe(true);
  });

  it('names the project as text, whatever the project is called', () => {
    const comment = buildReviewComment(REVIEW, 'de', 'App_ [x](https://evil.example) @all\n/merge');

    const last = comment.split('\n\n').at(-1) ?? '';
    expect(last.startsWith('_via Covibes, Projekt „App\\_ \\[x\\]')).toBe(true);
    expect(last.endsWith('“_')).toBe(true);
    expect(comment).not.toContain('://');
    for (const line of comment.split('\n')) expect(line.startsWith('/'), line).toBe(false);
  });
});

describe('buildReviewCommentActions', () => {
  it('is one action that names the merge request, the review and the comment', () => {
    const actions = buildReviewCommentActions(REVIEW, 'de', PROJECT);

    expect(actions).toEqual([
      {
        kind: 'comment',
        payload: {
          title: 'Review von !7: 2 Abweichungen',
          number: 7,
          reviewId: REVIEW.id,
          body: buildReviewComment(REVIEW, 'de', PROJECT),
        },
      },
    ]);
    expect(gitActionDraftSchema.safeParse(actions[0]).success).toBe(true);
    expect(
      buildReviewCommentActions({ ...REVIEW, verdict: 'fits', findings: [] }, 'en', PROJECT)[0]
        ?.payload.title,
    ).toBe('Review of !7: fits the architecture');
    expect(
      buildReviewCommentActions(
        { ...REVIEW, findings: REVIEW.findings.slice(0, 1) },
        'de',
        PROJECT,
      )[0]?.payload.title,
    ).toBe('Review von !7: 1 Abweichung');
  });
});
