const SUPPORTED_NODE_RANGE = '>=24.22.1 <25';

function isSupportedVersion(version) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major === 24 && (minor > 22 || (minor === 22 && patch >= 1));
}

function assertSupportedRuntime(version = process.versions.node, loadSqlite = () => require('node:sqlite')) {
  if (!isSupportedVersion(version)) {
    throw new Error(`Unsupported Node.js ${version}. V2 requires ${SUPPORTED_NODE_RANGE}. No application database was opened. Configure a supported Node.js environment before starting.`);
  }
  let probe;
  try {
    const { DatabaseSync } = loadSqlite();
    probe = new DatabaseSync(':memory:');
    if (typeof probe.isTransaction !== 'boolean') {
      throw new Error('SQLite transaction-state support is missing');
    }
  } catch (error) {
    throw new Error(`V2 runtime check failed: ${error.message}. No application database was opened.`);
  } finally {
    probe?.close();
  }
}

module.exports = { SUPPORTED_NODE_RANGE, isSupportedVersion, assertSupportedRuntime };
