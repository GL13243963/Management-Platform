import { createServer } from 'node:http';
import { chmod } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDesktop } from './open-desktop.mjs';
import taskParser from '../expense-task.cjs';
import { stageMaterials } from './material-staging.mjs';

const desktopPath = /^\/desktop\/([a-f0-9-]{36})(?:(?:\/materials\/(\d+))|(\/save))?$/;

async function readTask(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) throw new Error('Invalid payload size');
  }
  if (!body) return { task: null }; // The installer only tests browser startup and teardown.
  const data = JSON.parse(body);
  const task = taskParser.parseExpenseTask(data.task);
  if (!task) throw new Error('Invalid task');
  return { task, autoSave: data.autoSave === true };
}

export function createDesktopWorker({ open = openDesktop, ttlMs = 15 * 60_000 } = {}) {
  let active;

  function finish(session) {
    if (session.closing) return session.closing;
    clearTimeout(session.timer);
    session.controller.abort();
    session.closing = (async () => {
      const desktop = await session.opening.catch(() => null);
      try { await desktop?.close(); }
      finally { await session.materials?.close(); }
      if (active === session) active = undefined;
    })();
    return session.closing;
  }

  const server = createServer(async (req, res) => {
    const reply = (code, status, details) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status, ...details }));
    };
    const match = desktopPath.exec(req.url);
    if (!match) return reply(404, 'missing');
    const id = match[1];
    try {
      if (match[3]) {
        if (req.method !== 'POST') return reply(405, 'unsupported');
        const current = active;
        if (current?.id !== id || current.status !== 'ready' || current.closing || !current.materials) {
          return reply(409, 'unavailable');
        }
        current.saving ??= current.opening.then(desktop => desktop.save())
          .catch(() => ({ status: 'save-uncertain' }));
        const attempt = current.saving;
        const result = await attempt;
        if (['account-required', 'save-blocked'].includes(result.status) && current.saving === attempt) current.saving = undefined;
        return reply(200, result.status, { documentNumber: result.documentNumber });
      }
      if (match[2] !== undefined) {
        if (req.method !== 'PUT') return reply(405, 'unsupported');
        if (active?.id !== id || !active.materials || active.closing) return reply(404, 'missing');
        try { await active.materials.upload(Number(match[2]), req); }
        catch { return reply(400, 'invalid'); }
        return reply(200, 'received');
      }
      if (req.method === 'POST') {
        let request;
        try { request = await readTask(req); }
        catch { return reply(400, 'invalid'); }
        const { task, autoSave } = request;
        const taskKey = JSON.stringify([task, autoSave]);
        if (active && (active.id !== id || active.taskKey !== taskKey || active.closing)) return reply(409, 'busy');
        if (!active) {
          const session = { id, taskKey, controller: new AbortController(), status: 'waiting', progress: [] };
          if (task) session.materials = stageMaterials(taskParser.materialNames(task), session.controller.signal);
          active = session;
          session.opening = Promise.resolve().then(() => open({
            task, autoSave, materials: session.materials?.ready, signal: session.controller.signal,
            onProgress: (stage, menuRetries) => session.progress.push({
              stage, menuRetries, workerTime: new Date().toISOString(), workerVersion: '20261117-runs-1',
            }),
          }));
          session.timer = setTimeout(() => finish(session).catch(console.error), ttlMs);
          session.opening.then(async desktop => {
            session.review = await desktop.ready;
            session.status = 'ready';
          }).catch(error => {
            session.status = error.code === 'TICKETS_UNAVAILABLE' ? 'tickets-unavailable' : 'failed';
            session.review = { stage: error.stage || 'portal-login', portalDetail: error.portalDetail };
          });
        }
        const session = active;
        try {
          await session.opening;
        } catch (error) {
          console.error('Expense desktop startup failed', error);
          await finish(session);
          return reply(503, 'failed');
        }
        return session.closing ? reply(410, 'expired') : reply(200, session.status, { ...session.review, progress: session.progress });
      }
      if (active?.id !== id) return reply(404, 'missing');
      if (req.method === 'GET') return reply(200, active.closing ? 'expired' : active.status, { ...active.review, progress: active.progress });
      if (req.method === 'DELETE') {
        await finish(active);
        return reply(200, 'closed');
      }
      return reply(405, 'unsupported');
    } catch (error) {
      console.error('Expense desktop cleanup failed', error);
      return reply(503, 'failed');
    }
  });

  return {
    server,
    close: async () => {
      server.close();
      if (active) await finish(active);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.env.EXPENSE_WORKER_SOCKET;
  if (!path?.startsWith('/run/')) throw new Error('EXPENSE_WORKER_SOCKET must be under /run.');
  process.umask(0o007);
  const worker = createDesktopWorker();
  worker.server.listen(path, async () => {
    await chmod(path, 0o660);
    console.log('Expense desktop worker ready.');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => worker.close().catch(error => {
      console.error(error);
      process.exitCode = 1;
    }));
  }
}
