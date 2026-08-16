import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCanonicalWrite } from '../src/security/canonical_write_auth.js';

test('Canonical writes fail closed when no server token is configured', () => {
  assert.deepEqual(authorizeCanonicalWrite(undefined, undefined), {
    authorized: false,
    code: 'CANONICAL_WRITES_DISABLED'
  });
});

test('Canonical writes reject missing, malformed and incorrect bearer tokens', () => {
  const configured = 'editorial-secret';
  assert.deepEqual(authorizeCanonicalWrite(undefined, configured), {
    authorized: false,
    code: 'CANONICAL_WRITE_UNAUTHORIZED'
  });
  assert.deepEqual(authorizeCanonicalWrite('Basic editorial-secret', configured), {
    authorized: false,
    code: 'CANONICAL_WRITE_UNAUTHORIZED'
  });
  assert.deepEqual(authorizeCanonicalWrite('Bearer wrong-secret', configured), {
    authorized: false,
    code: 'CANONICAL_WRITE_UNAUTHORIZED'
  });
});

test('Canonical writes accept only the exact configured bearer token', () => {
  assert.deepEqual(authorizeCanonicalWrite('Bearer editorial-secret', 'editorial-secret'), {
    authorized: true
  });
});
