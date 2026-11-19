const test = require('node:test');
const assert = require('node:assert/strict');
const { isSupportedVersion, assertSupportedRuntime } = require('../src/utils/runtime');

test('runtime version policy accepts supported 24.x releases only', () => {
  for (const version of ['24.22.1', '24.22.2', '24.23.0']) assert.equal(isSupportedVersion(version), true);
  for (const version of ['22.14.0', '22.16.0', '24.0.0', '24.22.0', '25.0.0', '26.0.0', '24.22.1-rc.1', 'invalid']) assert.equal(isSupportedVersion(version), false);
});

test('unsupported runtime is rejected before loading SQLite', () => {
  let loaded = false;
  assert.throws(() => assertSupportedRuntime('22.14.0', () => { loaded = true; }), /Unsupported Node/);
  assert.equal(loaded, false);
});

test('missing transaction-state capability rejects runtime and closes memory probe', () => {
  let closed = false;
  class MissingCapability { close() { closed = true; } }
  assert.throws(() => assertSupportedRuntime('24.22.1', () => ({ DatabaseSync: MissingCapability })), /transaction-state support is missing/);
  assert.equal(closed, true);
});

test('runtime check uses and closes an in-memory database only', () => {
  let closed = false;
  class ValidCapability {
    constructor(target) { assert.equal(target, ':memory:'); this.isTransaction = false; }
    close() { closed = true; }
  }
  assert.doesNotThrow(() => assertSupportedRuntime('24.22.1', () => ({ DatabaseSync: ValidCapability })));
  assert.equal(closed, true);
});

test('current test runtime supplies native SQLite transaction-state support', () => {
  assert.doesNotThrow(() => assertSupportedRuntime());
});
