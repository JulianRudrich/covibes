import { describe, expect, it } from 'vitest';

import { projectSettingsSchema, updateProjectInputSchema } from '../projects';

import { addKnowledgeLinkInputSchema, agentKnowledgeItemSchema, webUrlSchema } from './knowledge';

describe('webUrlSchema', () => {
  it('takes http and https addresses, trimmed', () => {
    expect(webUrlSchema.parse(' https://example.org/vereinsrecht?x=1#a ')).toBe(
      'https://example.org/vereinsrecht?x=1#a',
    );
    expect(webUrlSchema.safeParse('http://example.org').success).toBe(true);
  });

  it('refuses everything else', () => {
    for (const value of [
      '',
      'example.org',
      'www.example.org',
      'ftp://example.org',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://',
      `https://example.org/${'a'.repeat(2000)}`,
    ]) {
      expect(webUrlSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('addKnowledgeLinkInputSchema', () => {
  it('takes a link with an optional note', () => {
    expect(addKnowledgeLinkInputSchema.parse({ url: 'https://example.org' })).toEqual({
      url: 'https://example.org',
      note: '',
    });
    expect(
      addKnowledgeLinkInputSchema.parse({ url: 'https://example.org', note: '  Überblick ' }),
    ).toEqual({ url: 'https://example.org', note: 'Überblick' });
  });

  it('limits the note', () => {
    const input = (note: string) =>
      addKnowledgeLinkInputSchema.safeParse({ url: 'https://example.org', note });

    expect(input('x'.repeat(200)).success).toBe(true);
    expect(input('x'.repeat(201)).success).toBe(false);
    expect(input('a\u0000b').success).toBe(false);
  });
});

describe('agentKnowledgeItemSchema', () => {
  it('describes a file and a link', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const file = {
      id,
      kind: 'file',
      name: 'satzung.pdf',
      url: null,
      note: '',
      fileKind: 'pdf',
      mediaType: 'application/pdf',
      sizeBytes: 1200,
    };
    const link = {
      id,
      kind: 'link',
      name: 'https://example.org',
      url: 'https://example.org',
      note: 'Überblick',
      fileKind: null,
      mediaType: null,
      sizeBytes: null,
    };

    expect(agentKnowledgeItemSchema.parse(file)).toEqual(file);
    expect(agentKnowledgeItemSchema.parse(link)).toEqual(link);
    expect(agentKnowledgeItemSchema.safeParse({ ...file, kind: 'folder' }).success).toBe(false);
  });
});

describe('web access in the project settings', () => {
  it('is a switch owners change, and unreadable values count as not set', () => {
    expect(updateProjectInputSchema.parse({ webAccess: false })).toEqual({ webAccess: false });
    expect(updateProjectInputSchema.safeParse({ webAccess: 'no' }).success).toBe(false);
    expect(projectSettingsSchema.parse({ webAccess: false }).webAccess).toBe(false);
    expect(projectSettingsSchema.parse({ webAccess: 'no' }).webAccess).toBeUndefined();
    expect(projectSettingsSchema.parse({}).webAccess).toBeUndefined();
  });
});
