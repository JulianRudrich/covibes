import pg from 'pg';

export const DATABASE_NAME = 'covibes';
export const ADMIN_ROLE = 'covibes_admin';
export const APP_ROLE = 'covibes_app';

export function connectionUrl(options: {
  user: string;
  password: string;
  port: number;
  database: string;
  host?: string;
}): string {
  const url = new URL(`postgres://${options.host ?? '127.0.0.1'}:${String(options.port)}`);
  url.username = options.user;
  url.password = options.password;
  url.pathname = `/${options.database}`;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates (or updates) the two roles and the database. Needs a superuser connection; runs on every
 * local start, so passwords always match `.data/local-secrets.json`.
 * - covibes_admin owns the database and all tables: migrations, the login library and the worker.
 * - covibes_app serves requests on behalf of a user and is always subject to RLS.
 */
export async function bootstrapCluster(options: {
  superuserUrl: string;
  adminPassword: string;
  appPassword: string;
  database?: string;
}): Promise<void> {
  const database = options.database ?? DATABASE_NAME;

  await withClient(options.superuserUrl, async (client) => {
    const roles = [
      [ADMIN_ROLE, options.adminPassword, 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
      [
        APP_ROLE,
        options.appPassword,
        'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT',
      ],
    ] as const;
    for (const [role, password, attributes] of roles) {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await client.query(
        `${verb} ROLE ${role} WITH ${attributes} PASSWORD ${client.escapeLiteral(password)}`,
      );
    }

    const hasDatabase = await client.query('select 1 from pg_database where datname = $1', [
      database,
    ]);
    if (!hasDatabase.rowCount) {
      await client.query(
        `CREATE DATABASE ${client.escapeIdentifier(database)} OWNER ${ADMIN_ROLE}`,
      );
    }
    const quotedDatabase = client.escapeIdentifier(database);
    await client.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${ADMIN_ROLE}, ${APP_ROLE}`);
    await client.query(`GRANT CREATE, TEMPORARY ON DATABASE ${quotedDatabase} TO ${ADMIN_ROLE}`);
  });

  const databaseUrl = new URL(options.superuserUrl);
  databaseUrl.pathname = `/${database}`;
  await withClient(databaseUrl.toString(), async (client) => {
    // Nobody but the admin role may create objects in the public schema.
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`ALTER SCHEMA public OWNER TO ${ADMIN_ROLE}`);
  });
}
