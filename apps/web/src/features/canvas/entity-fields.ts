import { ENTITY_FIELDS_MAX, type EntityField } from '@covibes/shared';

/** Longest name and type of a field, as the model allows (spec 12). */
const FIELD_PART_MAX = 40;

/** The fields of an entity as the text of its editor: one field per line, "name type". */
export function fieldLines(fields: readonly EntityField[]): string {
  return fields
    .map((field) => (field.type ? `${field.name} ${field.type}` : field.name))
    .join('\n');
}

/**
 * The fields in the text of the editor: the first word of a line is the name, the rest its type.
 * Empty lines are dropped; overlong parts are cut and fields beyond the limit left out, so what
 * someone typed never makes the change fail.
 */
export function parseFieldLines(text: string): EntityField[] {
  const fields: EntityField[] = [];
  for (const line of text.split('\n')) {
    const [name = '', ...rest] = line.trim().split(/\s+/);
    if (!name) continue;
    fields.push({
      name: name.slice(0, FIELD_PART_MAX),
      type: rest.join(' ').slice(0, FIELD_PART_MAX).trim(),
    });
    if (fields.length === ENTITY_FIELDS_MAX) break;
  }
  return fields;
}
