const { randomUUID } = require('node:crypto');
const { parseExpenseTask } = require('./expense-task.cjs');

// Mount after the OS authenticate and requireChangedPassword middleware.
function createLoginSessions({ Router, origin, openBrowser, ttlMs = 15 * 60_000, onCleanupError = console.error, records, runs }) {
  const allowedOrigin = new URL(origin).origin;
  const router = Router();
  let active;
  let lastExpired;

  function owns(req, session) {
    return !!session && req.auth?.user?.id === session.userId && req.auth?.sessionId === session.owner;
  }

  function markRun(session, status, stage, details) {
    session.runStage = stage;
    session.runStatus = status;
    runs?.record(session.id, status, stage, details);
  }

  async function finish(session, status) {
    if (session.controller.signal.aborted) return;
    clearTimeout(session.timer);
    session.status = status;
    session.controller.abort();
    if (!['saved', 'interrupted'].includes(session.runStatus)) {
      markRun(session, status === 'closed' ? 'cancelled' : 'interrupted', session.runStage, { code: status });
    }
    if (status !== 'closed' && !session.saved && !session.failureStage) {
      void records?.failure(session.id, status === 'expired' ? 'session' : 'login-or-fill', status);
    }
    lastExpired = { id: session.id, owner: session.owner, userId: session.userId, status, saveResult: session.saveResult };
    // A launcher that rejects is responsible for rolling back partial startup.
    const browser = await session.opening.catch(() => null);
    try {
      await browser?.close();
    } catch (error) {
      onCleanupError('Expense login browser cleanup failed', error);
      return;
    }
    if (active === session) active = undefined;
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.auth?.sessionId || req.auth?.user?.id == null) return res.sendStatus(401);
    next();
  });

  async function sendWindow(res, session, status) {
    try {
      await session.opening;
    } catch {
      return res.status(503).json({ code: 'EXPENSE_LOGIN_UNAVAILABLE' });
    }
    if (session.controller.signal.aborted) return res.status(503).json({ code: 'EXPENSE_LOGIN_UNAVAILABLE' });
    return res.status(status).json({ id: session.id, viewerPath: session.viewerPath });
  }

  async function saveSession(session) {
    if (!session.saving && session.expiresAt - Date.now() < 120_000) {
      session.saveResult = { status: 'review-expired' };
      markRun(session, 'interrupted', 'save', { code: 'review-expired' });
      return session.saveResult;
    }
    if (!session.saving) {
      const execute = () => session.opening.then(browser => browser.save());
      session.saveInFlight = true;
      markRun(session, 'progress', 'save');
      session.saving = (records ? records.saveOnce(session.userId, session.taskKey, execute) : execute())
        .catch(() => ({ status: 'save-uncertain' }))
        .then(result => {
          session.saveResult = result;
          if (result.status === 'saved') {
            session.saved = true;
            markRun(session, 'saved', 'save', { receiptConfirmed: !!result.documentNumber });
          } else {
            markRun(session, 'interrupted', 'save', { code: result.status, receiptConfirmed: false });
            void records?.failure(session.id, 'save', result.status);
          }
          return result;
        }).finally(() => { session.saveInFlight = false; });
    }
    const attempt = session.saving;
    const result = await attempt;
    if (['account-required', 'save-blocked'].includes(result.status) && session.saving === attempt) session.saving = undefined;
    return result;
  }

  router.post('/', (req, res) => {
    if (req.get('origin') !== allowedOrigin) return res.sendStatus(403);
    const task = parseExpenseTask(req.body);
    if (!task) return res.status(400).json({ code: 'EXPENSE_TASK_INVALID' });
    const autoSave = req.body.autoSave === true;
    const taskKey = JSON.stringify(task);
    if (owns(req, active) && !active.controller.signal.aborted) {
      if (active.taskKey !== taskKey || active.autoSave !== autoSave) return res.status(409).json({ code: 'EXPENSE_LOGIN_BUSY' });
      return sendWindow(res, active, 200);
    }
    if (active) return res.status(409).json({ code: 'EXPENSE_LOGIN_BUSY' });
    const id = randomUUID();
    const session = {
      id, viewerPath: `/apps/expense-assistant/login/${id}`,
      owner: req.auth.sessionId, userId: req.auth.user.id,
      status: 'waiting', controller: new AbortController(), taskKey, autoSave, expiresAt: Date.now() + ttlMs,
    };
    active = session;
    markRun(session, 'started', 'desktop-start');
    session.opening = Promise.resolve().then(() => openBrowser({
      id, task, autoSave, signal: session.controller.signal,
      onProgress: details => {
        if (session.controller.signal.aborted) return;
        markRun(session, 'progress', details.stage, {
          menuRetries: details.menuRetries, workerTime: details.workerTime, workerVersion: details.workerVersion,
        });
      },
    }));
    session.timer = setTimeout(() => void finish(session, 'expired'), ttlMs);
    session.timer.unref();
    session.opening.then(async browser => {
      const review = await browser.ready;
      session.maskedAccount = review?.maskedAccount;
      if (session.controller.signal.aborted) return;
      session.status = 'ready';
      markRun(session, 'progress', 'review');
      if (session.autoSave && session.maskedAccount) await saveSession(session);
    }).catch(error => {
      const status = error.code === 'TICKETS_UNAVAILABLE' ? 'tickets-unavailable' : 'failed';
      if (session.controller.signal.aborted) return;
      if (!error.stage) return finish(session, status);
      session.status = status;
      session.failureStage = error.stage;
      session.portalDetail = error.portalDetail;
      markRun(session, 'interrupted', error.stage, { code: error.code || status });
      void records?.failure(session.id, error.stage, status);
    });
    return sendWindow(res, session, 201);
  });

  router.get('/:id', (req, res) => {
    const session = [active, lastExpired].find(candidate => candidate?.id === req.params.id);
    if (!owns(req, session)) return res.sendStatus(404);
    const result = session.saveInFlight ? { status: 'saving' } : session.saveResult || { status: session.status };
    res.json({ ...result, maskedAccount: session.maskedAccount, stage: session.failureStage, portalDetail: session.portalDetail });
  });

  router.delete('/:id', async (req, res) => {
    if (req.get('origin') !== allowedOrigin) return res.sendStatus(403);
    const session = active;
    if (!owns(req, session) || session.id !== req.params.id) return res.sendStatus(404);
    if (session.saveInFlight) return res.sendStatus(409);
    await finish(session, 'closed');
    return active === session ? res.sendStatus(503) : res.sendStatus(204);
  });

  router.put('/:id/materials/:index', async (req, res) => {
    if (req.get('origin') !== allowedOrigin) return res.sendStatus(403);
    const session = active;
    if (!owns(req, session) || session.id !== req.params.id || session.controller.signal.aborted) return res.sendStatus(404);
    const index = Number(req.params.index);
    const size = Number(req.get('content-length'));
    if (!/^\d+$/.test(req.params.index) || !Number.isSafeInteger(index) ||
        req.get('content-type') !== 'application/pdf' || !Number.isSafeInteger(size) ||
        size < 5 || size > 20 * 1024 * 1024) return res.sendStatus(400);
    try {
      const browser = await session.opening;
      await browser.upload(index, req, size);
      return res.sendStatus(204);
    } catch {
      markRun(session, 'interrupted', 'material-transfer', { code: 'upload-failed' });
      void records?.failure(session.id, 'material-transfer', 'upload-failed');
      return res.status(503).json({ code: 'EXPENSE_MATERIAL_UNAVAILABLE' });
    }
  });

  router.post('/:id/save', async (req, res) => {
    if (req.get('origin') !== allowedOrigin) return res.sendStatus(403);
    const session = active;
    if (!owns(req, session) || session.id !== req.params.id || session.status !== 'ready') return res.sendStatus(404);
    return res.json(await saveSession(session));
  });

  function authorizeViewer(req, id) {
    return owns(req, active) && active.id === id && !active.controller.signal.aborted &&
      (['waiting', 'ready'].includes(active.status) || !!active.failureStage);
  }

  function viewerSignal(req, id) {
    return authorizeViewer(req, id) ? active.controller.signal : undefined;
  }

  return { router, authorizeViewer, viewerSignal };
}

module.exports = { createLoginSessions };
