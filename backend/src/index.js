const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Loading models runs schema-init; wrap in try so we see the error clearly.
try {
  require('./models');
} catch (err) {
  console.error('\n[FATAL] Failed to initialize database:');
  console.error(err);
  process.exit(1);
}

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/employees',  require('./routes/employees'));
app.use('/api/projects',   require('./routes/projects'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/analytics',  require('./routes/analytics'));

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
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ==============================================');
  console.log('    Innovation Center backend is READY');
  console.log(`    Open in browser:  http://localhost:${PORT}`);
  if (!frontendBuilt) console.log('    (Frontend not built - showing status page)');
  console.log('  ==============================================\n');
});
