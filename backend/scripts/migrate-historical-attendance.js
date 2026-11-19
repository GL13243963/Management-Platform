const fs = require('node:fs');
const path = require('node:path');
const { assertSupportedRuntime } = require('../src/utils/runtime');

const [action, databasePath, ...extra] = process.argv.slice(2);
if (action !== '--apply' || !databasePath || !path.isAbsolute(databasePath) || extra.length) {
  throw new Error('Usage: node scripts/migrate-historical-attendance.js --apply <absolute-existing-db-path>');
}
if (!fs.statSync(databasePath).isFile()) {
  throw new Error('The migration requires an existing SQLite database file');
}
assertSupportedRuntime();
const { DatabaseSync } = require('node:sqlite');
const sql = fs.readFileSync(path.join(__dirname, 'historical-attendance.sql'), 'utf8');
const db = new DatabaseSync(databasePath);
try {
  db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
} finally {
  db.close();
}
console.log('Historical attendance migration committed');
