import type { GitActionDraft } from './git-requests';
import type { GitReviewFinding, GitReviewVerdict } from './git-reviews';
import type { PlanLanguage } from './plan';

// The review of a merge request as a comment in the repository (spec 30c). The server builds the
// comment from the stored review; what the model wrote goes into it as plain text.

/** The longest comment; a longer review is cut at a finding. */
export const MAX_REVIEW_COMMENT_LENGTH = 20_000;

/** A character that shows nothing and keeps what stands around it from reading as one word. */
const BREAK = String.fromCodePoint(0x200b);

/**
 * Whether a character is text to keep: no control character, and none of the invisible marks
 * that join words, hide text or turn its direction around.
 */
function isText(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code === 0x0a) return true;
  if (code < 0x20 || code === 0x7f) return false;
  if (code >= 0x200b && code <= 0x200f) return false;
  if (code >= 0x2028 && code <= 0x202e) return false;
  if (code >= 0x2060 && code <= 0x206f) return false;
  return code !== 0xfeff;
}

/** One line of a text, inert: see `inertText`. */
function inertLine(line: string): string {
  const inert = line
    // What starts a mention, a reference or a command of a bot.
    .replace(/[@#!~%$&^]/g, `$&${BREAK}`)
    // Addresses: "https://…" and "www.…".
    .replace(/:\/\//g, `:${BREAK}//`)
    .replace(/www\./gi, `www${BREAK}.`)
    // What Markdown reads as more than itself wherever it stands: emphasis, code, links, HTML,
    // headings, tables, strike-through, formulas, entities and inline changes.
    .replace(/[\\`*_[\]<>|~$&#^{}]/g, '\\$&');
  // What only the start of a line turns into something: a list, a rule, the line under a
  // heading, a directive, and a quick action ("/merge").
  if (/^[-+=/:]/.test(inert)) return `\\${inert}`;
  return inert.replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * Makes a text inert for a host that reads comments as Markdown. A review reads a merge request,
 * which comes from outside, so what the model wrote of it must show in the repository as the text
 * it is and do nothing there:
 * - no formatting, no HTML, no link: what means something in Markdown is escaped, wherever it
 *   stands or at the start of a line; the punctuation of plain sentences stays as it is, so the
 *   text also reads where Markdown is not shown, e.g. in a mail
 * - no mention of a person, no reference to an issue, a merge request or a label, and no address
 *   that turns into a link: GitLab finds these in the text after it read the Markdown, so the
 *   characters that start them are followed by an invisible break
 * - no quick action: no line starts with "/"
 */
export function inertText(text: string): string {
  return (
    text
      .split(/\r\n|\r|\n/)
      // Without what is no text; a tab is a blank. Indented lines would be code.
      .map((line) => Array.from(line.replaceAll('\t', ' ')).filter(isText).join('').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .split('\n')
      .map(inertLine)
      .join('\n')
  );
}

type CommentTexts = {
  heading: string;
  fits: string;
  deviates: (count: number) => string;
  state: (sha: string) => string;
  basis: string;
  file: string;
  cut: (count: number) => string;
  note: string;
  /** The note everything ends with that Covibes creates in a repository. */
  via: (projectName: string) => string;
  title: (number: number, verdict: GitReviewVerdict, findings: number) => string;
};

const TEXTS: Readonly<Record<PlanLanguage, CommentTexts>> = {
  de: {
    heading: 'Review gegen die Architektur',
    fits: 'Passt zur Architektur',
    deviates: (count) =>
      count === 1
        ? '1 Abweichung von der Architektur'
        : `${String(count)} Abweichungen von der Architektur`,
    state: (sha) => `Stand ${sha}`,
    basis: 'Architektur',
    file: 'Datei',
    cut: (count) =>
      count === 1
        ? 'Eine weitere Abweichung steht in Covibes.'
        : `${String(count)} weitere Abweichungen stehen in Covibes.`,
    note: 'Ein Modell hat dieses Review geschrieben, ein Mensch hat den Kommentar freigegeben.',
    via: (projectName) => `via Covibes, Projekt „${projectName}“`,
    title: (number, verdict, findings) =>
      verdict === 'fits'
        ? `Review von !${String(number)}: passt zur Architektur`
        : `Review von !${String(number)}: ${
            findings === 1 ? '1 Abweichung' : `${String(findings)} Abweichungen`
          }`,
  },
  en: {
    heading: 'Review against the architecture',
    fits: 'Fits the architecture',
    deviates: (count) =>
      count === 1
        ? '1 deviation from the architecture'
        : `${String(count)} deviations from the architecture`,
    state: (sha) => `state ${sha}`,
    basis: 'Architecture',
    file: 'File',
    cut: (count) =>
      count === 1
        ? 'One more deviation is in Covibes.'
        : `${String(count)} more deviations are in Covibes.`,
    note: 'A model wrote this review, a person approved the comment.',
    via: (projectName) => `via Covibes, project "${projectName}"`,
    title: (number, verdict, findings) =>
      verdict === 'fits'
        ? `Review of !${String(number)}: fits the architecture`
        : `Review of !${String(number)}: ${
            findings === 1 ? '1 deviation' : `${String(findings)} deviations`
          }`,
  },
};

/** What of a review its comment is built from. */
export type ReviewForComment = {
  id: string;
  /** The merge request, as people write it: "!7". */
  number: number;
  /** The last commit of the merge request that the review is about. */
  sha: string;
  verdict: GitReviewVerdict;
  summary: string;
  findings: readonly GitReviewFinding[];
};

/**
 * The comment of a review as Markdown, in the project's language: what was reviewed, the verdict,
 * the summary and the findings, each with what it goes against and the file it shows in. Only the
 * frame is Markdown; every text of the model, and the project's name, is made inert
 * (`inertText`). It ends with the note that it came via Covibes. A review too long for a comment
 * loses its last findings, and says how many.
 */
export function buildReviewComment(
  review: ReviewForComment,
  language: PlanLanguage,
  projectName: string,
): string {
  const texts = TEXTS[language];
  const head = [
    `### ${texts.heading}`,
    `**${
      review.verdict === 'fits' ? texts.fits : texts.deviates(review.findings.length)
    }** · ${texts.state(inertText(review.sha.slice(0, 8)))}`,
    inertText(review.summary),
  ];
  const foot = (left: number) => [
    ...(left > 0 ? [`_${texts.cut(left)}_`] : []),
    '---',
    `_${texts.note}_`,
    `_${texts.via(inertText(projectName))}_`,
  ];
  const findings = review.findings.map((finding, index) =>
    [
      `**${String(index + 1)}\\. ${inertText(finding.title)}**`,
      inertText(finding.detail),
      [
        finding.basis ? `- ${texts.basis}: ${inertText(finding.basis)}` : null,
        finding.file ? `- ${texts.file}: ${inertText(finding.file)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
  const build = (shown: number) =>
    [...head, ...findings.slice(0, shown), ...foot(findings.length - shown)].join('\n\n');
  let shown = findings.length;
  while (shown > 0 && build(shown).length > MAX_REVIEW_COMMENT_LENGTH) shown -= 1;
  return build(shown).slice(0, MAX_REVIEW_COMMENT_LENGTH);
}

/** The one action of a request that posts a review as a comment at its merge request. */
export function buildReviewCommentActions(
  review: ReviewForComment,
  language: PlanLanguage,
  projectName: string,
): Extract<GitActionDraft, { kind: 'comment' }>[] {
  return [
    {
      kind: 'comment',
      payload: {
        title: TEXTS[language].title(review.number, review.verdict, review.findings.length),
        number: review.number,
        reviewId: review.id,
        body: buildReviewComment(review, language, projectName),
      },
    },
  ];
}
