import { describe, expect, it } from 'vitest';

import {
  attachmentIdsSchema,
  FILE_ACCEPT,
  fileExtension,
  formatFileSize,
  messageAttachmentSchema,
} from './files';
import { chatMessageSchema, sendMessageInputSchema } from './messages';

const FILE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('files (spec 20a)', () => {
  it('reads the extension of a file name', () => {
    expect(fileExtension('Notizen.MD')).toBe('md');
    expect(fileExtension('archiv.tar.gz')).toBe('gz');
    expect(fileExtension('ohne')).toBe('');
    expect(fileExtension('.env')).toBe('');
    expect(fileExtension('punkt.')).toBe('');
  });

  it('formats sizes for people', () => {
    expect(formatFileSize(512, 'de')).toBe('512 B');
    expect(formatFileSize(340_200, 'de')).toBe('340 kB');
    expect(formatFileSize(2_400_000, 'de')).toBe('2,4 MB');
    expect(formatFileSize(2_400_000, 'en')).toBe('2.4 MB');
  });

  it('offers images, PDFs and text formats in the file picker', () => {
    expect(FILE_ACCEPT).toContain('image/png');
    expect(FILE_ACCEPT).toContain('application/pdf');
    expect(FILE_ACCEPT).toContain('.md');
    expect(FILE_ACCEPT).not.toContain('svg');
  });

  it('attaches at most five files, each once', () => {
    expect(attachmentIdsSchema.safeParse([FILE, OTHER]).success).toBe(true);
    expect(attachmentIdsSchema.safeParse([FILE, FILE]).success).toBe(false);
    expect(attachmentIdsSchema.safeParse(['nope']).success).toBe(false);
    const six = Array.from(
      { length: 6 },
      (_, index) => `${String(index)}1111111-1111-4111-8111-111111111111`,
    );
    expect(attachmentIdsSchema.safeParse(six).success).toBe(false);
  });

  it('is part of a message and of sending one', () => {
    const attachment = {
      id: FILE,
      name: 'skizze.png',
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: 1200,
    };
    expect(messageAttachmentSchema.safeParse({ ...attachment, kind: 'video' }).success).toBe(false);
    const message = chatMessageSchema.parse({
      id: 'm1',
      projectId: 'p1',
      author: { kind: 'human', userId: 'u1', name: 'Olga' },
      content: 'Schaut mal',
      mentions: [],
      replyTo: null,
      status: 'complete',
      attachments: [attachment],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(message.attachments).toEqual([attachment]);

    const input = { id: OTHER, content: 'Schaut mal' };
    expect(sendMessageInputSchema.parse(input)).toEqual(input);
    expect(sendMessageInputSchema.parse({ ...input, attachments: [FILE] }).attachments).toEqual([
      FILE,
    ]);
    expect(
      sendMessageInputSchema.safeParse({ ...input, content: '', attachments: [FILE] }).success,
    ).toBe(false);
  });
});
