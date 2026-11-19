const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function expensePilotInfo(app) {
  if (app.appId !== 'expense-assistant' || app.status !== 'placeholder'
      || process.env.EXPENSE_PILOT_ENABLED !== 'true') return null;
  const index = path.join(__dirname, '../../expense-assistant/dist/index.html');
  try {
    // The HTML references Vite assets by content hash.
    const build = createHash('sha256').update(fs.readFileSync(index)).digest('hex').slice(0, 12);
        return { entry: '/apps/expense-assistant/', build };
  } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

module.exports = { expensePilotInfo };
