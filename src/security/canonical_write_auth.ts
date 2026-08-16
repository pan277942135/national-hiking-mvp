import crypto from 'node:crypto';

export type CanonicalWriteAuthResult =
  | { authorized: true }
  | { authorized: false; code: 'CANONICAL_WRITES_DISABLED' | 'CANONICAL_WRITE_UNAUTHORIZED' };

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Canonical truth mutation endpoints are internal/editorial APIs.
 *
 * When CANONICAL_WRITE_TOKEN is absent, writes are disabled rather than
 * silently becoming public. When configured, callers must use
 * `Authorization: Bearer <token>`.
 */
export function authorizeCanonicalWrite(
  authorizationHeader: string | undefined,
  configuredToken: string | undefined = process.env.CANONICAL_WRITE_TOKEN
): CanonicalWriteAuthResult {
  if (!configuredToken) {
    return { authorized: false, code: 'CANONICAL_WRITES_DISABLED' };
  }

  const prefix = 'Bearer ';
  if (!authorizationHeader?.startsWith(prefix)) {
    return { authorized: false, code: 'CANONICAL_WRITE_UNAUTHORIZED' };
  }

  const supplied = authorizationHeader.slice(prefix.length);
  if (!supplied || !constantTimeEqual(supplied, configuredToken)) {
    return { authorized: false, code: 'CANONICAL_WRITE_UNAUTHORIZED' };
  }

  return { authorized: true };
}
