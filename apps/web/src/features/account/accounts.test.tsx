import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@web/i18n';
import { renderApp } from '@web/test-utils';

// Better Fetch captures its transport when the client module is imported. Install this
// HTTP boundary before imports, then change only its responses for each scenario.
const transport = vi.hoisted(() => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
});

const person = {
  id: 'cfa5bca8-576f-45fb-a8d6-8badb01c0191',
  name: 'A person',
  email: 'person@example.com',
  locale: 'en',
  twoFactorEnabled: false,
};
const now = new Date().toISOString();
const session = {
  id: 'current',
  token: 'current-session',
  userId: person.id,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  userAgent: 'This browser',
};
type Reply = { body: unknown; status?: number };
type Handler = (init: RequestInit | undefined) => Reply | Promise<Reply>;

/** Exercise the real auth client and router with HTTP responses, including their error shape. */
function serve(signedIn: boolean, handlers: Record<string, Handler>) {
  const routes: Record<string, Handler> = {
    'GET /api/auth/get-session': () => ({ body: signedIn ? { user: person, session } : null }),
    'GET /api/config': () => ({
      body: {
        emailLogin: true,
        emailCodeLogin: true,
        passkeyLogin: false,
        socialLogins: [],
        closedBeta: true,
      },
    }),
    'GET /api/auth/list-sessions': () => ({
      body: [
        session,
        { ...session, id: 'other', token: 'other-session', userAgent: 'Other browser' },
      ],
    }),
    'GET /api/auth/passkey/list-user-passkeys': () => ({ body: [] }),
    ...handlers,
  };
  const fetcher = transport.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const key = `${init?.method ?? (input instanceof Request ? input.method : 'GET')} ${new URL(url, 'http://localhost').pathname}`;
      const handler = routes[key];
      const reply = handler
        ? await handler(init)
        : { status: 404, body: { code: 'NOT_FOUND', message: key } };
      return Response.json(reply.body, { status: reply.status ?? 200 });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('account flows (spec 42)', () => {
  it('continues an email-code sign-in to its required authenticator and announces a rejected recovery proof', async () => {
    await i18n.changeLanguage('en');
    const requestCode = vi.fn<Handler>(() => ({ body: { success: true } }));
    const verifyCode = vi.fn<Handler>(() => ({
      body: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
    }));
    const verifyRecovery = vi.fn<Handler>(() => ({
      status: 400,
      body: { code: 'INVALID_BACKUP_CODE', message: 'Invalid' },
    }));
    serve(false, {
      'POST /api/auth/email-otp/send-verification-otp': requestCode,
      'POST /api/auth/sign-in/email-otp': verifyCode,
      'POST /api/auth/two-factor/verify-backup-code': verifyRecovery,
    });
    renderApp('/login?redirect=%2Faccount');
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: person.email },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send one-time code' }));
    expect(
      await screen.findByText(
        `A one-time code was sent to ${person.email}. It expires in ten minutes.`,
      ),
    ).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('Verification code')).toHaveFocus();
    expect(JSON.parse(requestCode.mock.calls[0]?.[0]?.body as string)).toEqual({
      email: person.email,
      type: 'sign-in',
    });
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByRole('heading', { name: 'Verify your sign-in' })).toBeInTheDocument();
    expect(JSON.parse(verifyCode.mock.calls[0]?.[0]?.body as string)).toEqual({
      email: person.email,
      otp: '123456',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'recovery-proof' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not be completed');
    expect(JSON.parse(verifyRecovery.mock.calls[0]?.[0]?.body as string)).toEqual({
      code: 'recovery-proof',
    });
  });

  it('keeps profile and session controls usable and requires the account email before requesting deletion', async () => {
    await i18n.changeLanguage('en');
    const save = vi.fn<Handler>(() => ({ body: { status: true } }));
    const revoke = vi.fn<Handler>(() => ({ body: { status: true } }));
    const remove = vi.fn<Handler>(() => ({
      body: { success: true, message: 'Verification email sent' },
    }));
    serve(true, {
      'POST /api/auth/update-user': save,
      'POST /api/auth/revoke-session': revoke,
      'POST /api/auth/delete-user': remove,
    });
    renderApp('/account');
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: '  New name  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(JSON.parse(save.mock.calls[0]?.[0]?.body as string)).toEqual({ name: 'New name' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign out this device' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out this device' }));
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledOnce();
    });
    expect(JSON.parse(revoke.mock.calls[0]?.[0]?.body as string)).toEqual({
      token: 'other-session',
    });
    const deletion = screen.getByRole('button', { name: 'Request permanent deletion' });
    expect(deletion).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type your account email to confirm'), {
      target: { value: 'someone@example.com' },
    });
    expect(deletion).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type your account email to confirm'), {
      target: { value: person.email },
    });
    await waitFor(() => expect(deletion).toBeEnabled());
    fireEvent.click(deletion);
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('shows authenticator setup and recovery codes intentionally and retains setup after a rejected confirmation', async () => {
    await i18n.changeLanguage('en');
    const confirm = vi.fn<Handler>(() => ({
      status: 400,
      body: { code: 'INVALID_CODE', message: 'Invalid' },
    }));
    serve(true, {
      'POST /api/auth/two-factor/enable': () => ({
        body: {
          method: 'totp',
          totpURI: 'otpauth://totp/Covibes?secret=EXAMPLE',
          backupCodes: ['first-private-code', 'second-private-code'],
        },
      }),
      'POST /api/auth/two-factor/verify-totp': confirm,
    });
    renderApp('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByLabelText('Authenticator setup address')).toHaveValue(
      'otpauth://totp/Covibes?secret=EXAMPLE',
    );
    expect(screen.getByLabelText('Manual authenticator setup key')).toHaveValue('EXAMPLE');
    expect(screen.getByText(/first-private-code/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '000000' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Verify and continue' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This action could not be completed',
    );
    expect(screen.getByLabelText('Authenticator setup address')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide recovery codes' }));
    expect(screen.queryByText(/first-private-code/)).not.toBeInTheDocument();
  });

  it.each([
    ['LAST_OWNER', 'Transfer ownership of your shared projects'],
    ['SESSION_EXPIRED', 'Sign in again to confirm'],
  ])('explains a blocked deletion (%s) without claiming completion', async (code, message) => {
    await i18n.changeLanguage('en');
    serve(true, {
      'POST /api/auth/delete-user': () => ({
        status: code === 'LAST_OWNER' ? 409 : 400,
        body: { code, message: 'Blocked' },
      }),
    });
    renderApp('/account');
    fireEvent.change(await screen.findByLabelText('Type your account email to confirm'), {
      target: { value: person.email },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request permanent deletion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument();
    if (code === 'SESSION_EXPIRED')
      expect(screen.getByRole('button', { name: 'Sign out and sign in again' })).toBeEnabled();
  });
});
