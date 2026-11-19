const { assertSupportedRuntime } = require('../src/utils/runtime');

try {
  assertSupportedRuntime();
  console.log(`V2 runtime check passed: Node.js ${process.versions.node}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
