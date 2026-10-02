/** Error body of every API route. `code` is stable and mapped to i18n texts by the web app. */
export type ApiErrorBody = {
  /** `detail` adds what the web app needs for its text, e.g. the name of someone editing a block. */
  error: { code: ApiErrorCode; message: string; detail?: string };
};

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'too_large'
  | 'too_many_requests'
  | 'limit_reached'
  | 'already_decided'
  | 'being_edited'
  | 'name_taken'
  | 'unsupported_file'
  | 'already_member'
  | 'last_owner'
  | 'internal';

/** `GET /api/config`: settings the web app may know before login. */
export type PublicConfig = {
  gitlabLogin: boolean;
  /** False in production without SMTP: then there is no login link by mail. */
  emailLogin: boolean;
  devMailbox: boolean;
};

/** One mail of the development mailbox (`GET /api/dev/mails`, development only). */
export type DevMail = { id: number; to: string; subject: string; text: string; sentAt: string };
