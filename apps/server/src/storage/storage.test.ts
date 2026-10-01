import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { cleanFileName, detectFile } from '@server/storage/file-kind';
import { localStorage, memoryStorage } from '@server/storage/storage';
import { GIF, JPEG, pdf, PNG, WEBP } from '@server/test-files';

const directory = mkdtempSync(join(tmpdir(), 'covibes-files-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe.each([
  ['a local folder', () => localStorage(join(directory, 'nested', 'files'))],
  ['memory', () => memoryStorage()],
])('file storage in %s', (_, create) => {
  it('stores, returns and removes content by key', async () => {
    const storage = create();
    const key = randomUUID();
    expect(await storage.get(key)).toBeUndefined();

    await storage.put(key, PNG);
    expect((await storage.get(key))?.equals(PNG)).toBe(true);

    await storage.delete(key);
    expect(await storage.get(key)).toBeUndefined();
    // Removing what is not there is fine.
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('takes nothing but the keys the server makes up', async () => {
    const storage = create();
    for (const key of ['../secret', 'a/b', '', 'notizen.md', randomUUID().toUpperCase()]) {
      await expect(storage.put(key, PNG)).rejects.toThrow('Invalid storage key');
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
      await expect(storage.delete(key)).rejects.toThrow('Invalid storage key');
    }
  });
});

describe('local file storage', () => {
  it('keeps one file per key in its folder', async () => {
    const folder = join(directory, 'flat');
    const storage = localStorage(folder);
    const key = randomUUID();
    await storage.put(key, Buffer.from('Hallo'));
    expect(readdirSync(folder)).toEqual([key]);
  });
});

describe('detectFile', () => {
  const text = (content: string) => Buffer.from(content, 'utf8');

  it('knows images and PDFs by their signature, whatever they are called', () => {
    expect(detectFile('bild.txt', PNG)).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(detectFile('foto', JPEG)).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(detectFile('a.gif', GIF)).toEqual({ kind: 'image', mediaType: 'image/gif' });
    expect(detectFile('a.webp', WEBP)).toEqual({ kind: 'image', mediaType: 'image/webp' });
    expect(detectFile('plan.pdf', pdf(['Hallo']))).toEqual({
      kind: 'pdf',
      mediaType: 'application/pdf',
    });
  });

  it('takes known text formats that are valid UTF-8', () => {
    expect(detectFile('Notizen.MD', text('# Ideen\nÄpfel'))).toEqual({
      kind: 'text',
      mediaType: 'text/markdown',
    });
    expect(detectFile('daten.csv', text('a;b\n1;2'))).toEqual({
      kind: 'text',
      mediaType: 'text/csv',
    });
    expect(detectFile('seite.html', text('<script>alert(1)</script>'))).toEqual({
      kind: 'text',
      mediaType: 'text/html',
    });
  });

  it('refuses what only claims to be something', () => {
    // An image that is none, an SVG, a program, text in another encoding, binary as text.
    expect(detectFile('bild.png', text('kein Bild'))).toBeUndefined();
    expect(
      detectFile('logo.svg', text('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeUndefined();
    expect(detectFile('setup.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeUndefined();
    expect(detectFile('alt.txt', Buffer.from([0x48, 0xe4, 0x6c, 0x6c, 0x6f]))).toBeUndefined();
    expect(detectFile('daten.txt', Buffer.from([0x41, 0x00, 0x42]))).toBeUndefined();
    expect(detectFile('ohne-endung', text('Text'))).toBeUndefined();
  });
});

describe('cleanFileName', () => {
  it('keeps the name and drops folders and control characters', () => {
    expect(cleanFileName('Notizen.md')).toBe('Notizen.md');
    expect(cleanFileName('C:\\Users\\olga\\skizze.png')).toBe('skizze.png');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('  a\u0000b\n.txt ')).toBe('ab.txt');
    expect(cleanFileName('   ')).toBe('file');
  });

  it('shortens a long name and keeps its extension', () => {
    const name = cleanFileName(`${'x'.repeat(300)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
