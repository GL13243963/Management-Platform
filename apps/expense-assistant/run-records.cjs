const fs = require('node:fs');
const path = require('node:path');

function createRunRecords(logDir, frontendVersion = () => 'legacy') {
  const file = date => path.join(logDir, 'runs-' + date.toISOString().slice(0, 10) + '.jsonl');
  const day = 86400000;
  return {
    record(id, status, stage, details = {}) {
      const now = new Date();
      try {
        fs.appendFileSync(file(now), JSON.stringify({ id, time: now.toISOString(), status, stage, ...(status === 'started' ? { frontendVersion: frontendVersion() } : {}), ...details }) + '\n', { mode: 0o600 });
      } catch (error) {
        console.error('Expense run log unavailable', error.code);
      }
    },
    summary({ diagnostic = false, now = Date.now() } = {}) {
      const since = now - 7 * day;
      const runs = new Map();
      for (let offset = 8; offset >= 0; offset--) {
        let content;
        try { content = fs.readFileSync(file(new Date(now - offset * day)), 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const line of content.trim().split('\n').filter(Boolean)) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.status === 'started' && Date.parse(event.time) >= since) {
            runs.set(event.id, { started: event.time, last: event, events: [] });
          }
          const run = runs.get(event.id);
          if (!run) continue;
          if (diagnostic) run.events.push(event);
          run.last = event;
        }
      }
      const interrupted = [];
      for (const [id, run] of runs) {
        const last = run.last;
        const expired = ['started', 'progress'].includes(last.status) && Date.parse(run.started) + 15 * 60000 <= now;
        if (last.status === 'interrupted' || expired) {
          interrupted.push({ time: expired ? new Date(Date.parse(run.started) + 15 * 60000).toISOString() : last.time,
            stage: last.stage, ...(diagnostic ? { id, code: expired ? 'session-timeout' : last.code } : {}) });
        }
      }
      interrupted.sort((a, b) => b.time.localeCompare(a.time));
      return {
        days: 7, runs: runs.size, interruptionCount: interrupted.length,
        interrupted: diagnostic ? interrupted : interrupted.slice(0, 20),
        ...(diagnostic ? { sessions: [...runs.values()].map(run => run.events) } : {}),
      };
    },
  };
}

module.exports = { createRunRecords };
