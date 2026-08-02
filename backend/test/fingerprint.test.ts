import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintEvent, normFile, normMsg, normUrlPath, parseStack } from '../src/fingerprint.js';

test('same exception at different line/col groups identically', () => {
  const a = fingerprintEvent({
    type: 'exception',
    message: "Cannot read properties of undefined (reading 'name')",
    error_type: 'TypeError',
    stack: "TypeError: Cannot read properties of undefined (reading 'name')\n    at renderUser (http://site.test/app.js:10:5)\n    at main (http://site.test/app.js:99:1)"
  });
  const b = fingerprintEvent({
    type: 'exception',
    message: "Cannot read properties of undefined (reading 'name')",
    error_type: 'TypeError',
    stack: "TypeError: Cannot read properties of undefined (reading 'name')\n    at renderUser (http://site.test/app.js:14:22)\n    at main (http://site.test/app.js:120:8)"
  });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('content-hashed bundle filenames group across deploys', () => {
  const a = fingerprintEvent({
    type: 'exception',
    message: 'boom',
    error_type: 'Error',
    stack: 'Error: boom\n    at f (https://cdn.test/assets/app.a1b2c3d4.js:1:100)'
  });
  const b = fingerprintEvent({
    type: 'exception',
    message: 'boom',
    error_type: 'Error',
    stack: 'Error: boom\n    at f (https://cdn.test/assets/app.ffee0011.js:1:100)'
  });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('different error types do not group', () => {
  const base = { type: 'exception' as const, message: 'boom', stack: 'Error: boom\n    at f (http://s/app.js:1:1)' };
  const a = fingerprintEvent({ ...base, error_type: 'TypeError' });
  const b = fingerprintEvent({ ...base, error_type: 'RangeError' });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('exception and unhandled_rejection with identical stacks stay separate', () => {
  const stack = 'Error: nope\n    at f (http://s/app.js:1:1)';
  const a = fingerprintEvent({ type: 'exception', message: 'nope', error_type: 'Error', stack });
  const b = fingerprintEvent({ type: 'unhandled_rejection', message: 'nope', error_type: 'Error', stack });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('messages with volatile ids group together', () => {
  const a = fingerprintEvent({ type: 'console_error', message: 'Failed to load user 12345 (req 550e8400-e29b-41d4-a716-446655440000)' });
  const b = fingerprintEvent({ type: 'console_error', message: 'Failed to load user 99 (req 123e4567-e89b-42d3-a456-426614174000)' });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('network errors group by method+status+normalized path, not query or ids', () => {
  const a = fingerprintEvent({
    type: 'network_error',
    meta: { method: 'GET', status: 500, request_url: 'https://api.test/users/123/orders?page=1' }
  });
  const b = fingerprintEvent({
    type: 'network_error',
    meta: { method: 'GET', status: 500, request_url: 'https://api.test/users/987/orders?page=44' }
  });
  const c = fingerprintEvent({
    type: 'network_error',
    meta: { method: 'GET', status: 404, request_url: 'https://api.test/users/123/orders' }
  });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.match(a.title, /GET \/users\/<n>\/orders → HTTP 500/);
});

test('connection failures (status 0) group separately from HTTP errors', () => {
  const a = fingerprintEvent({ type: 'network_error', meta: { method: 'GET', status: 0, request_url: 'https://api.test/data' } });
  const b = fingerprintEvent({ type: 'network_error', meta: { method: 'GET', status: 500, request_url: 'https://api.test/data' } });
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.match(a.title, /network failure/);
});

test('performance events group by metric and page path', () => {
  const a = fingerprintEvent({ type: 'performance', url: 'https://site.test/checkout?step=2', meta: { metric: 'slow_load', value: 5000 } });
  const b = fingerprintEvent({ type: 'performance', url: 'https://site.test/checkout', meta: { metric: 'slow_load', value: 9000 } });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('parseStack handles V8 format', () => {
  const frames = parseStack(
    "TypeError: x\n    at foo (http://s/app.js:10:5)\n    at http://s/app.js:20:3\n    at async bar (http://s/main.js:1:9)"
  );
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], { fn: 'foo', file: 'http://s/app.js', line: 10, col: 5 });
  assert.equal(frames[1]!.fn, '');
  assert.equal(frames[2]!.fn, 'bar');
});

test('parseStack handles Firefox/Safari format', () => {
  const frames = parseStack('foo@http://s/app.js:10:5\n@http://s/app.js:20:3');
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { fn: 'foo', file: 'http://s/app.js', line: 10, col: 5 });
});

test('SDK frames are excluded from fingerprints', () => {
  const withSdkFrame = fingerprintEvent({
    type: 'console_error',
    message: 'oops',
    stack: 'Error\n    at captureConsole (http://s/bugdetekter.min.js:1:500)\n    at userCode (http://s/app.js:5:1)'
  });
  const without = fingerprintEvent({
    type: 'console_error',
    message: 'oops',
    stack: 'Error\n    at userCode (http://s/app.js:5:1)'
  });
  assert.equal(withSdkFrame.fingerprint, without.fingerprint);
});

test('normalizers', () => {
  assert.equal(normFile('https://cdn.test/js/chunk-abc12345def.js?v=3'), '/js/chunk-<hash>.js');
  assert.equal(normMsg('error 42 at https://x.test/y?id=7'), 'error <n> at <url>');
  assert.equal(normUrlPath('https://a.b/users/42/items/550e8400-e29b-41d4-a716-446655440000'), '/users/<n>/items/<uuid>');
});
