import test from 'node:test';
import assert from 'node:assert/strict';
import { oidcUrl } from '../../src/orgo/modules/identity/oidc.service';

test('OIDC URLs accept HTTPS endpoints', () => {
  assert.equal(oidcUrl('https://id.example.test/').protocol, 'https:');
});

test('OIDC URLs allow localhost HTTP only outside production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    assert.equal(oidcUrl('http://127.0.0.1:8080').hostname, '127.0.0.1');
    assert.equal(oidcUrl('http://localhost:8080').hostname, 'localhost');
    assert.throws(() => oidcUrl('http://id.example.test'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('OIDC URLs reject localhost HTTP in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => oidcUrl('http://localhost:8080'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
