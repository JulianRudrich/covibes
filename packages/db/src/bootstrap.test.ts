import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Roles, rights and settings every later migration builds on (spec 02a).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('roles', () => {
  it('neither role is superuser, and covibes_app cannot bypass RLS', async () => {
    const { rows } = await admin.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         from pg_roles where rolname in ('covibes_admin', 'covibes_app') order by rolname`,
    );
    expect(rows).toEqual([
      {
        rolname: 'covibes_admin',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'covibes_app',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
  });

  it('covibes_app cannot create tables', async () => {
    await expect(app.query('create table public.not_allowed (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('private.current_user_id()', () => {
  it('is null without a user and the user id inside a transaction', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await asUser(app, null, async (client) => {
      const { rows } = await client.query('select private.current_user_id() as id');
      expect(rows[0]).toEqual({ id: null });
    });
    await asUser(app, id, async (client) => {
      const { rows } = await client.query('select private.current_user_id() as id');
      expect(rows[0]).toEqual({ id });
    });
  });
});

describe('database', () => {
  it('stores text as UTF-8', async () => {
    const { rows } = await admin.query(
      `select pg_encoding_to_char(encoding) as encoding, 'Grüße 🎉'::text as text
         from pg_database where datname = current_database()`,
    );
    expect(rows[0]).toEqual({ encoding: 'UTF8', text: 'Grüße 🎉' });
  });
});
