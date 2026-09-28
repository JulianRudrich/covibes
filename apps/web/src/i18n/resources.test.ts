import { describe, expect, it } from 'vitest';

import de from './de.json';
import en from './en.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n resources', () => {
  it('has the same keys in German and English', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(de).sort());
  });

  it('has no empty strings', () => {
    const values = (value: unknown): unknown[] =>
      typeof value === 'object' && value !== null ? Object.values(value).flatMap(values) : [value];
    expect(values(de).filter((text) => text === '')).toEqual([]);
    expect(values(en).filter((text) => text === '')).toEqual([]);
  });
});
