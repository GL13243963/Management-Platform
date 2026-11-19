const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticate, requireChangedPassword, requireAnyRole } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Loading models runs schema-init; wrap in try so we see the error clearly.
try {
  require('./models');
} catch (err) {
  console.error('\n[FATAL] Failed to initialize database:');
  console.error(err);
  process.exit(1);
}

const { router: systemRouter, currentVersion } = require('./routes/system');
app.get('/api/health', (req, res) => res.json({ ok: true, version: currentVersion(), ts: Date.now() }));
app.use('/api/auth', require('./routes/auth'));

// Every business API below this point requires a valid 8-hour session and a
// completed first-login password change.
const { trackActivity, readOverview } = require('./services/platform-activity');
app.use('/api', authenticate, requireChangedPassword, trackActivity);
app.get('/api/os/v1/app-management/activity', requireAnyRole('admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(readOverview()); }
  catch { res.status(503).json({ error: '暂时无法读取运行概览，请稍后重试' }); }
});
app.use('/api', (req, res, next) => {
  const sensitiveRead = req.method === 'GET'
    && (req.path.startsWith('/attendance') || req.path.startsWith('/analytics'));
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (sensitiveRead || mutation) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        req.audit(sensitiveRead ? 'sensitive_data_viewed' : 'api_data_changed', 'api', req.path, {
          method: req.method,
          status: res.statusCode,
        });
      }
    });
  }
  next();
});

app.use('/api/users',      require('./routes/users'));
const operationsRuntime = require('./routes/tool-matrix-runtime').createModule({appId:'operations'});
app.use('/api/os/v1/apps/operations/runtime', operationsRuntime.api);
app.use('/api/weekly', operationsRuntime.access,     require('./routes/weekly'));
app.use('/api/employees', operationsRuntime.access,  require('./routes/employees'));
app.use('/api/projects', operationsRuntime.access,   require('./routes/projects'));
app.use('/api/attendance', operationsRuntime.access, require('./routes/attendance'));
app.use('/api/analytics', operationsRuntime.access,  require('./routes/analytics'));
const galleryRuntime = require('./routes/tool-matrix-runtime').createModule({appId:'render-gallery'});
app.use('/api/render-gallery', galleryRuntime.access, require('./routes/render-gallery'));
app.use('/api/os/v1/apps/render-gallery/runtime', galleryRuntime.api);
const toolMatrixRuntime = require('./routes/tool-matrix-runtime').createModule();
app.use('/api/tool-matrix', toolMatrixRuntime.access, require('./routes/tool-matrix'));
app.use('/api/os/v1/apps/tool-matrix/runtime', toolMatrixRuntime.api);
const managementRouter = require('./routes/app-management').createRouter;
const availableModules = ['tool-matrix', 'render-gallery', 'operations'];
const expenseRuntime = process.env.EXPENSE_PILOT_ENABLED === 'true'
  && process.env.EXPENSE_ASSISTANT_RUNTIME_CONFIG && process.env.EXPENSE_ASSISTANT_ASSET_ROOT
  ? require('./routes/tool-matrix-runtime').createModule({appId:'expense-assistant'})
  : null;
if (expenseRuntime) availableModules.push(expenseRuntime.appId);
app.use('/api/os/v1/app-management', managementRouter({...toolMatrixRuntime,currentVersion,availableModules}));
app.use('/api/os/v1/app-management', require('./routes/app-management').createRouter({...galleryRuntime,currentVersion}));
app.use('/api/os/v1/app-management', require('./routes/app-management').createRouter({...operationsRuntime,currentVersion}));
if (expenseRuntime) {
  app.use('/api/os/v1/apps/expense-assistant/runtime', expenseRuntime.api);
  app.use('/api/os/v1/app-management', managementRouter({...expenseRuntime,currentVersion}));
}
app.use('/api/system',     systemRouter);
app.use('/api/os/v1/apps', require('./routes/os-apps'));

if (expenseRuntime) {
  app.get('/apps/expense-assistant/', authenticate, requireChangedPassword, expenseRuntime.access, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let entry;
    try {
      const { runtime } = require('./services/tool-matrix-runtime');
      entry = runtime(expenseRuntime.configPath, expenseRuntime.assetRoot, expenseRuntime.appId).entry;
    } catch (error) {
      console.error('Expense frontend version unavailable:', error.message);
    }
    return entry ? res.redirect(302, entry) : next();
  });
  app.use('/apps/expense-assistant', (req, res, next) => {
    if (req.path.startsWith('/versions/')) return expenseRuntime.assets(req, res, next);
    next();
  });
}

app.use('/api', (err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器处理失败，请稍后重试' });
});

app.use('/apps/tool-matrix', toolMatrixRuntime.assets);
app.use('/apps/render-gallery', galleryRuntime.assets);
app.use('/apps/operations', operationsRuntime.assets);

const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
const distIndex = path.join(distDir, 'index.html');
const frontendBuilt = fs.existsSync(distIndex);

if (frontendBuilt) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(distIndex);
  });
} else {
  app.get('/', (req, res) => {
    res.status(200).send(
      `<h2>Backend is running &#10003;</h2>
       <p>Frontend build (frontend/dist) not found.</p>
       <p>Run <code>npm run build</code> in the /frontend folder,
       or use <code>start-dev.bat</code> and open <a href="http://localhost:5173">http://localhost:5173</a>.</p>
       <p>API health: <a href="/api/health">/api/health</a></p>`
    );
  });
}

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ==============================================');
    console.log('    Innovation Center backend is READY');
    console.log(`    Open in browser:  http://localhost:${PORT}`);
    if (!frontendBuilt) console.log('    (Frontend not built - showing status page)');
    console.log('  ==============================================\n');
  });
}

module.exports = app;
