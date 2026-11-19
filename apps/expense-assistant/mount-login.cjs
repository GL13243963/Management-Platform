const { createLoginSessions } = require('./login-sessions.cjs');
const { createLoginViewer } = require('./login-viewer.cjs');
const { createWorkerClient } = require('./worker-client.cjs');

const apiPath = '/api/os/v1/expense-assistant/login-sessions';
const viewerPath = '/apps/expense-assistant/login';

// The OS auth middleware uses status/json and setHeader on auth failures.
// For upgrades, resolve a denial without sending an HTTP response through Express.
function authenticateSocket(req, checks) {
  return new Promise((resolve, reject) => {
    const denial = {
      status: () => denial,
      setHeader() {},
      json: () => resolve(undefined),
    };
    let index = 0;
    function next(error) {
      if (error) return reject(error);
      const check = checks[index++];
      if (!check) return resolve(req.auth);
      try { check(req, denial, next); }
      catch (cause) { reject(cause); }
    }
    next();
  });
}

function mountExpenseLogin(app, {
  express, authenticate, requireChangedPassword, origin, workerSocket,
  openBrowser = createWorkerClient({ socketPath: workerSocket }), novncRoot, websockifyPort, frontendRoot, records, runs,
}) {
  const checks = [authenticate, requireChangedPassword];
  const sessions = createLoginSessions({ Router: express.Router, origin, openBrowser, records, runs });
  const viewer = createLoginViewer({
    express, sessions, origin, novncRoot, websockifyPort,
    authenticateUpgrade: req => authenticateSocket(req, checks),
  });
  app.use(apiPath, ...checks, sessions.router);
  if (runs) {
    app.get('/api/os/v1/expense-assistant/runs', ...checks, (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!req.auth.user.roles?.some(role => role.role === 'admin')) return res.sendStatus(403);
      const diagnostic = req.query.download === '1';
      try {
        const result = runs.summary({ diagnostic });
        if (diagnostic) res.attachment('expense-run-diagnostics.json');
        return res.json(result);
      } catch {
        return res.status(503).json({ error: '运行记录暂不可用' });
      }
    });
  }
  if (records) {
    app.post('/api/os/v1/expense-assistant/feedback', ...checks, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.get('origin') !== new URL(origin).origin) return res.sendStatus(403);
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message || message.length > 1000) return res.sendStatus(400);
      try {
        await records.feedback(req.auth.user.id, message);
        return res.sendStatus(204);
      } catch (error) {
        console.error('Expense pilot feedback unavailable', error.code);
        return res.sendStatus(503);
      }
    });
  }
  app.use(viewerPath, ...checks, viewer.router);
  if (frontendRoot) {
    app.use('/apps/expense-assistant', ...checks, express.static(frontendRoot, { fallthrough: false }));
  }

  // Call from the OS server's upgrade dispatcher. Other applications may
  // register their own paths on the same server.
  function handleUpgrade(req, socket, head) {
    if (!req.url?.startsWith(viewerPath + '/')) return false;
    void viewer.upgrade(req, socket, head).catch(() => socket.destroy());
    return true;
  }

  return { handleUpgrade };
}

module.exports = { mountExpenseLogin };
