// Small real files for tests (spec 20a): what a browser would upload.

/** A 1 × 1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The start of a JPEG; enough for the signature. */
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

export const GIF = Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1');

export const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

/**
 * A PDF with one page per text, built with a correct cross-reference table, so the PDF library
 * reads it like a real one.
 */
export function pdf(pages: readonly string[]): Buffer {
  const escaped = (text: string) => text.replace(/[\\()]/g, (character) => `\\${character}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, index) => {
    const stream = `BT /F1 18 Tf 20 100 Td (${escaped(text)}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents ${String(5 + index * 2)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
