import { describe, expect, it } from 'vitest';

import { AGENT_MENTION_NAMES } from './keys';
import { parseMentions, splitMentions } from './mentions';

describe('parseMentions', () => {
  it('recognizes the example from the spec', () => {
    expect(parseMentions('@Moderator, draw a block')).toEqual(['moderator']);
  });

  it('ignores case', () => {
    expect(parseMentions('@moderator and @BACKEND')).toEqual(['moderator', 'backend']);
  });

  it('accepts the German names of the agents', () => {
    expect(parseMentions('@Kritiker, was sagen die @Daten?')).toEqual(['critic', 'data']);
    expect(parseMentions('@Critic and @Data')).toEqual(['critic', 'data']);
  });

  it.each([
    ['@Moderator,', ['moderator']],
    ['@Moderator.', ['moderator']],
    ['@Moderator!', ['moderator']],
    ['@Moderator?', ['moderator']],
    ['@Moderator:', ['moderator']],
    ['@Moderator;', ['moderator']],
    ['(@Moderator)', ['moderator']],
    ['"@Moderator"', ['moderator']],
    ['@Moderator-', ['moderator']],
    ['@Moderator…', ['moderator']],
  ])('strips trailing punctuation in %j', (text, expected) => {
    expect(parseMentions(text)).toEqual(expected);
  });

  it('finds mentions at the start, in the middle, after line breaks and at the end', () => {
    expect(parseMentions('@backend first\nthen\n@critic and finally @data')).toEqual([
      'backend',
      'critic',
      'data',
    ]);
  });

  it('does not match inside email addresses', () => {
    expect(parseMentions('mail sam@moderator.dev or kim.backend@data.io')).toEqual([]);
    expect(parseMentions('write to a+b@critic.org')).toEqual([]);
  });

  it('does not match inside links', () => {
    expect(parseMentions('see https://youtube.com/@backend and medium.com/@data/post')).toEqual([]);
    expect(parseMentions('mailto:@moderator')).toEqual([]);
  });

  it('does not match addresses that end in a domain', () => {
    expect(parseMentions('"john doe"@data.io and a#@critic.org')).toEqual([]);
    expect(parseMentions('@data.io is a domain, @datadata.io too')).toEqual([]);
  });

  it('still accepts a mention at the end of a sentence', () => {
    expect(parseMentions('Ask the @Moderator.')).toEqual(['moderator']);
    expect(parseMentions('Ask \'@Moderator\' and "@Backend".')).toEqual(['moderator', 'backend']);
  });

  it('does not match after a combining mark (decomposed accents)', () => {
    expect(parseMentions('café@moderator')).toEqual([]);
  });

  it('ignores mentions in inline code and code blocks', () => {
    expect(parseMentions('Type `@moderator` to call it')).toEqual([]);
    expect(parseMentions('```\nping @backend\n```\nthen @critic')).toEqual(['critic']);
  });

  it('counts every agent once, in the order of the first mention', () => {
    expect(parseMentions('@Critic @Backend @critic @Kritiker @backend')).toEqual([
      'critic',
      'backend',
    ]);
  });

  it('ignores unknown names and longer words that start with a known name', () => {
    expect(parseMentions('@Sam, @Moderators and @backend2 and @databases')).toEqual([]);
  });

  it('ignores a lone @ and double @@', () => {
    expect(parseMentions('@ @@moderator')).toEqual([]);
  });

  it('returns nothing for text without mentions', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('Just a normal message.')).toEqual([]);
  });

  it('accepts own names instead of the catalog names', () => {
    const names = { ...AGENT_MENTION_NAMES, moderator: ['mod'] };
    expect(parseMentions('@Mod and @Moderator', names)).toEqual(['moderator']);
  });

  it('knows every agent of the catalog by its German and English names (spec 14)', () => {
    expect(
      parseMentions(
        '@Produkt @UX @Datenbank @DevOps @Infra @Sicherheit @Datenschutz @ML @SEO @Content',
      ),
    ).toEqual(['product', 'frontend', 'data', 'devops', 'security', 'ml', 'content']);
  });
});

describe('splitMentions', () => {
  it('keeps the exact text and marks the mentions', () => {
    expect(splitMentions('Hi @Backend, see @Sam.')).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', text: '@Backend', key: 'backend' },
      { kind: 'text', text: ', see @Sam.' },
    ]);
  });

  it('keeps code as plain text, including the mentions in it', () => {
    expect(splitMentions('`@moderator` @Data')).toEqual([
      { kind: 'text', text: '`@moderator` ' },
      { kind: 'mention', text: '@Data', key: 'data' },
    ]);
  });

  it('returns a single text segment without mentions', () => {
    expect(splitMentions('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(splitMentions('')).toEqual([]);
  });
});
