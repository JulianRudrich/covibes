import { describe, expect, it } from 'vitest';

import { fieldLines, parseFieldLines } from '@web/features/canvas/entity-fields';

describe('entity fields in the editor', () => {
  it('reads one field per line, the first word as name and the rest as type', () => {
    expect(
      parseFieldLines('id uuid\n\n  email   text  \ncreated_at timestamp with time zone\nnote'),
    ).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'email', type: 'text' },
      { name: 'created_at', type: 'timestamp with time zone' },
      { name: 'note', type: '' },
    ]);
  });

  it('writes the fields back as lines', () => {
    const fields = [
      { name: 'id', type: 'uuid' },
      { name: 'note', type: '' },
    ];
    expect(fieldLines(fields)).toBe('id uuid\nnote');
    expect(parseFieldLines(fieldLines(fields))).toEqual(fields);
  });

  it('cuts overlong parts and stops at 20 fields', () => {
    const [field] = parseFieldLines(`${'n'.repeat(50)} ${'t'.repeat(50)}`);
    expect(field).toEqual({ name: 'n'.repeat(40), type: 't'.repeat(40) });
    const many = Array.from({ length: 25 }, (_, index) => `f${String(index)} text`).join('\n');
    expect(parseFieldLines(many)).toHaveLength(20);
    expect(parseFieldLines('  \n\n')).toEqual([]);
  });
});
