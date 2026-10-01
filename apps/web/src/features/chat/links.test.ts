import { describe, expect, it } from 'vitest';

import { splitLinks } from '@web/features/chat/links';

const links = (text: string) =>
  splitLinks(text).flatMap((segment) => (segment.kind === 'link' ? [segment.href] : []));

describe('splitLinks', () => {
  it('finds web addresses and leaves the text around them as it is', () => {
    expect(
      splitLinks('Schau mal: https://example.org/preise?plan=basis#team und sag was.'),
    ).toEqual([
      { kind: 'text', text: 'Schau mal: ' },
      {
        kind: 'link',
        text: 'https://example.org/preise?plan=basis#team',
        href: 'https://example.org/preise?plan=basis#team',
      },
      { kind: 'text', text: ' und sag was.' },
    ]);
    expect(splitLinks('Kein Link hier.')).toEqual([{ kind: 'text', text: 'Kein Link hier.' }]);
    expect(splitLinks('')).toEqual([]);
  });

  it('keeps the punctuation of the sentence out of the address', () => {
    expect(links('Siehe https://example.org/a. Oder https://example.org/b, oder?')).toEqual([
      'https://example.org/a',
      'https://example.org/b',
    ]);
    expect(links('(mehr unter https://example.org/c)')).toEqual(['https://example.org/c']);
    expect(links('„https://example.org/d“!')).toEqual(['https://example.org/d']);
    // A bracket that was opened in the address belongs to it.
    expect(links('https://de.wikipedia.org/wiki/Verein_(Recht).')).toEqual([
      'https://de.wikipedia.org/wiki/Verein_(Recht)',
    ]);
    const [, , rest] = splitLinks('Lies https://example.org/a.');
    expect(rest).toEqual({ kind: 'text', text: '.' });
  });

  it('lists several sources as the agents write them', () => {
    expect(
      links('Quellen: https://a.example/x, https://b.example/y?z=1, http://c.example'),
    ).toEqual(['https://a.example/x', 'https://b.example/y?z=1', 'http://c.example/']);
  });

  it('shows a Markdown link with its text', () => {
    expect(splitLinks('Laut [Preisliste](https://example.org/preise) sind es 5 €.')).toEqual([
      { kind: 'text', text: 'Laut ' },
      { kind: 'link', text: 'Preisliste', href: 'https://example.org/preise' },
      { kind: 'text', text: ' sind es 5 €.' },
    ]);
  });

  it('links nothing but http and https addresses', () => {
    for (const text of [
      'javascript:alert(1)',
      '[klick](javascript:alert(1))',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.org/datei',
      'file:///etc/passwd',
      'www.example.org',
      'sam@example.org',
      'https://',
      'http:// example.org',
    ]) {
      expect(links(text), text).toEqual([]);
      expect(
        splitLinks(text)
          .map((segment) => segment.text)
          .join(''),
        text,
      ).toBe(text);
    }
  });
});
