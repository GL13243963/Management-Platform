const path = require('node:path');
const fs = require('node:fs');
const { mountExpenseLogin } = require('./mount-login.cjs');
const { createRunRecords } = require('./run-records.cjs');
const { createPilotRecords } = require('./pilot-records.cjs');

function configureExpensePilot(app, middleware, env = process.env) {
  if (env.EXPENSE_PILOT_ENABLED !== 'true') return null;
  const origin = new URL(env.EXPENSE_PILOT_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.EXPENSE_PILOT_ORIGIN) {
    throw new Error('EXPENSE_PILOT_ORIGIN must be an HTTPS origin.');
  }
  const workerSocket = env.EXPENSE_WORKER_SOCKET;
  if (!workerSocket?.startsWith('/run/')) throw new Error('EXPENSE_WORKER_SOCKET must be under /run.');
  const frontendRoot = path.join(__dirname, 'dist');
  const novncRoot = env.EXPENSE_NOVNC_ROOT || '/usr/share/novnc';
  const stateDir = env.EXPENSE_PILOT_STATE_DIR || '/var/lib/innovation-center/expense-assistant';
  const logDir = env.EXPENSE_PILOT_LOG_DIR || '/var/log/innovation-center/expense-assistant';
  fs.accessSync(path.join(frontendRoot, 'index.html'), fs.constants.R_OK);
  fs.accessSync(path.join(novncRoot, 'vnc.html'), fs.constants.R_OK);
  for (const directory of [stateDir, logDir]) fs.accessSync(directory, fs.constants.W_OK);
  const frontendVersion = () => {
    try {
      const config = JSON.parse(fs.readFileSync(env.EXPENSE_ASSISTANT_RUNTIME_CONFIG, 'utf8'));
      return config.mode === 'independent' && /^v\d+\.\d+\.\d+$/.test(config.activeVersion) ? config.activeVersion : 'legacy';
    } catch { return 'legacy'; }
  };
  return mountExpenseLogin(app, {
    ...middleware,
    origin: origin.origin, workerSocket, frontendRoot, novncRoot, websockifyPort: 16081,
    runs: createRunRecords(logDir, frontendVersion),
    records: createPilotRecords({
      stateDir, failureFile: path.join(logDir, 'failures.jsonl'), feedbackFile: path.join(logDir, 'feedback.jsonl'),
    }),
  });
}

module.exports = { configureExpensePilot };
