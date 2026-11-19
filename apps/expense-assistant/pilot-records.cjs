const { createHash } = require('node:crypto');
const { appendFile, readFile, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

function createPilotRecords({ stateDir, failureFile, feedbackFile }) {
  return {
    async feedback(userId, message) {
      await appendFile(feedbackFile, JSON.stringify({ time: new Date().toISOString(), userId, message }) + '\n', { mode: 0o600 });
    },
    async failure(id, stage, code) {
      try {
        await appendFile(failureFile, JSON.stringify({ time: new Date().toISOString(), id, stage, code }) + '\n', { mode: 0o600 });
      } catch (error) {
        console.error('Expense failure log unavailable', error.code);
      }
    },
    async saveOnce(userId, taskKey, execute) {
      const key = createHash('sha256').update(JSON.stringify([userId, taskKey])).digest('hex');
      const record = path.join(stateDir, key + '.json');
      try {
        await writeFile(record, '{"status":"save-uncertain"}\n', { flag: 'wx', mode: 0o600, flush: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = JSON.parse(await readFile(record, 'utf8'));
        return existing.status === 'saved' ? existing : { status: 'save-uncertain' };
      }

      const result = await execute();
      if (['account-required', 'save-blocked'].includes(result.status)) {
        await unlink(record);
      } else if (result.status === 'saved') {
        const pending = record + '.next';
        await writeFile(pending, JSON.stringify(result) + '\n', { mode: 0o600, flush: true });
        await rename(pending, record);
      }
      return result;
    },
  };
}

module.exports = { createPilotRecords };
