const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('startup preserves historical attendance; explicit migration corrects it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-startup-'));
  const file = path.join(dir, 'app.db');
  const startup = () => execFileSync(process.execPath, ['-e',
    'require(process.argv[1]).raw.close()', path.resolve(__dirname, '../src/db.js')],
  { env: { ...process.env, APP_DB_PATH: file } });
  const read = () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT * FROM attendance_logs ORDER BY id').all();
    } finally {
      db.close();
    }
  };
  try {
    startup();
    const db = new DatabaseSync(file);
    try {
      db.exec(`INSERT INTO employees (id, name) VALUES (1, 'Synthetic');
        INSERT INTO attendance_logs
          (employeeId, employeeName, date, status, rawClockIn, clockOut, workHours)
        VALUES (1, 'Synthetic', '2026-01-01', 'absent', '漏刷', '18:00', 0);
        INSERT INTO attendance_logs
          (employeeId, employeeName, date, status, overrideType)
        VALUES (1, 'Synthetic', '2026-01-02', 'comp_leave', 'comp_leave');`);
    } finally {
      db.close();
    }
    const baseline = read();
    startup();
    assert.deepEqual(read(), baseline);
    execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/migrate-historical-attendance.js'), '--apply', file]);
    const rows = read();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'missed_punch');
    assert.equal(rows[0].missedPunchCount, 1);
    assert.equal(rows[0].workHours, 4);
    startup();
    assert.deepEqual(read(), rows);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
