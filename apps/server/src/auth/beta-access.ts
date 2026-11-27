import { APIError } from 'better-auth/api';
import type pg from 'pg';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Admission runs only after the primary method has proved the email identity. */
export async function requireBetaAccess(options: {
  production: boolean;
  email: string;
  verified: boolean;
  allowed: readonly string[];
  adminPool: pg.Pool;
}): Promise<void> {
  if (!options.production) return;
  const email = normalizeEmail(options.email);
  if (options.verified) {
    if (options.allowed.includes(email)) return;
    const invitation = await options.adminPool.query(
      `select 1 from public.beta_invitations where email = $1 and expires_at > now()
       union all
       select 1 from public.invitations
       where kind = 'email' and lower(email) = $1 and expires_at > now()
         and revoked_at is null and uses = 0
       union all
       select 1 from public.workspace_invitations
       where email = $1 and expires_at > now()
         and revoked_at is null and accepted_at is null
       limit 1`,
      [email],
    );
    if (invitation.rowCount) return;
  }
  throw new APIError('FORBIDDEN', {
    code: 'BETA_ACCESS_REQUIRED',
    message: 'Registration is limited to invited addresses.',
  });
}
