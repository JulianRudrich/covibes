import { describe, expect, it } from 'vitest';

import {
  BOARD_TITLE_MAX_LENGTH,
  boardTitleSchema,
  nextBoardTitle,
  PROJECT_NAME_MAX_LENGTH,
  projectIdSchema,
  projectNameSchema,
} from './projects';

describe('projectNameSchema', () => {
  it('trims the name', () => {
    expect(projectNameSchema.parse('  Covibes V1  ')).toBe('Covibes V1');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(projectNameSchema.safeParse('').success).toBe(false);
    expect(projectNameSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts the maximum length and rejects longer names', () => {
    expect(projectNameSchema.safeParse('x'.repeat(PROJECT_NAME_MAX_LENGTH)).success).toBe(true);
    expect(projectNameSchema.safeParse('x'.repeat(PROJECT_NAME_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });
});

describe('projectIdSchema', () => {
  it('accepts UUIDs only', () => {
    expect(projectIdSchema.safeParse('0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de').success).toBe(true);
    expect(projectIdSchema.safeParse('demo').success).toBe(false);
  });
});

describe('boardTitleSchema', () => {
  it('trims the title and limits it to 60 characters', () => {
    expect(boardTitleSchema.parse('  Datenmodell  ')).toBe('Datenmodell');
    expect(boardTitleSchema.safeParse('   ').success).toBe(false);
    expect(boardTitleSchema.safeParse('x'.repeat(BOARD_TITLE_MAX_LENGTH)).success).toBe(true);
    expect(boardTitleSchema.safeParse('x'.repeat(BOARD_TITLE_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('nextBoardTitle', () => {
  it('starts with "Board 2", since the main canvas is the first', () => {
    expect(nextBoardTitle(['Haupt-Canvas'])).toBe('Board 2');
  });

  it('takes the lowest free number', () => {
    expect(nextBoardTitle(['Haupt-Canvas', 'Board 2', 'Board 4'])).toBe('Board 3');
    expect(nextBoardTitle(['Haupt-Canvas', 'Board 2', 'Datenmodell', 'Board 3'])).toBe('Board 4');
  });
});
