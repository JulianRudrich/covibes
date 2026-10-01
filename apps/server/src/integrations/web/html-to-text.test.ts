import { describe, expect, it } from 'vitest';

import { decodeEntities, htmlToText } from '@server/integrations/web/html-to-text';

describe('htmlToText', () => {
  it('keeps what a reader sees and drops markup, scripts and styles', () => {
    const page = htmlToText(`<!doctype html>
      <html>
        <head>
          <title>Preise &amp; Pakete – Beispiel</title>
          <style>body { color: red }</style>
          <script>window.secret = '<p>nicht lesen</p>';</script>
        </head>
        <body>
          <!-- ein Kommentar -->
          <nav><a href="/">Start</a> <a href="/preise">Preise</a></nav>
          <h1>Preise</h1>
          <p>Das <b>Basis</b>-Paket kostet 5&nbsp;&euro; im&#32;Monat.</p>
          <ul><li>10 Mitglieder</li><li>1 GB Speicher</li></ul>
          <noscript>Bitte JavaScript einschalten</noscript>
          <svg><text>Logo</text></svg>
        </body>
      </html>`);

    expect(page.title).toBe('Preise & Pakete – Beispiel');
    expect(page.text).toBe(
      'Start Preise\n\nPreise\n\nDas Basis-Paket kostet 5 € im Monat.\n\n- 10 Mitglieder\n- 1 GB Speicher',
    );
  });

  it('separates table cells and line breaks', () => {
    const { text } = htmlToText(
      '<table><tr><th>Paket</th><th>Preis</th></tr><tr><td>Basis</td><td>5 €</td></tr></table>Zeile eins<br>Zeile zwei',
    );

    expect(text).toBe('Paket | Preis |\nBasis | 5 € |\n\nZeile eins\nZeile zwei');
  });

  it('copes with a page without a title and with text only', () => {
    expect(htmlToText('Nur Text')).toEqual({ title: '', text: 'Nur Text' });
    expect(htmlToText('<script>alert(1)</script>')).toEqual({ title: '', text: '' });
  });

  it('leaves text that only looks like markup after decoding as text', () => {
    // Decoded last: an escaped tag is content, not markup, and stays visible as written.
    expect(htmlToText('<p>&lt;script&gt;x&lt;/script&gt;</p>').text).toBe('<script>x</script>');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('&Auml;pfel &amp; Birnen &#8211; &#x20AC;5 &quot;gut&quot;')).toBe(
      'Äpfel & Birnen – €5 "gut"',
    );
  });

  it('keeps unknown names and replaces invalid code points', () => {
    expect(decodeEntities('&unbekannt; &#0; &#xD800; &#1114112;')).toBe('&unbekannt;      ');
  });
});
