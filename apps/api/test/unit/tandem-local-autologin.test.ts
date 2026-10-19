import test from 'node:test';
import assert from 'node:assert/strict';
import { localAutoLoginAllowed } from '../../src/orgo/modules/identity/local-autologin-policy';

const base = { NODE_ENV: 'development', ORGO_LOCAL_AUTO_LOGIN: 'true', ORGO_PUBLIC_URL: 'http://localhost:3000' };
test('local auto-login is disabled in production even with a loopback public URL', () => {
  assert.equal(localAutoLoginAllowed({ ...base, NODE_ENV: 'production' }, '127.0.0.1'), false);
});
test('local auto-login is off by default or without a configured public origin', () => {
  assert.equal(localAutoLoginAllowed({ ...base, ORGO_LOCAL_AUTO_LOGIN: 'false' }, '127.0.0.1'), false);
  assert.equal(localAutoLoginAllowed({ ...base, ORGO_PUBLIC_URL: '' }, '127.0.0.1'), false);
});
test('local auto-login requires local TCP peer, not a spoofable request header', () => {
  assert.equal(localAutoLoginAllowed(base, '198.51.100.10'), false);
  assert.equal(localAutoLoginAllowed(base, '172.18.0.1'), false);
  assert.equal(localAutoLoginAllowed(base, '127.0.0.1'), true);
  assert.equal(localAutoLoginAllowed(base, '::1'), true);
  assert.equal(localAutoLoginAllowed(base, '::ffff:127.0.0.1'), true);
});
test('local auto-login refuses non-local origins and malformed URLs', () => {
  for (const url of ['http://example.com','https://fakeplant.example.com','bad', 'http://u:p@localhost','http://localhost/#x'])
    assert.equal(localAutoLoginAllowed({ ...base, ORGO_PUBLIC_URL: url }, '127.0.0.1'), false);
});
