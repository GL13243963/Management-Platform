const http = require('node:http');

const prefix = '/apps/expense-assistant/login';
const upgradePath = /^\/apps\/expense-assistant\/login\/([a-f0-9-]{36})\/websockify$/;

function createLoginViewer({ express, sessions, origin, novncRoot, websockifyPort, authenticateUpgrade }) {
  const allowedOrigin = new URL(origin).origin;
  const router = express.Router();
  const assets = express.static(novncRoot, { index: false, redirect: false, fallthrough: false });

  // Mount after the same OS authentication and password checks used by the API.
  router.use('/:id', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!sessions.authorizeViewer(req, req.params.id)) return res.sendStatus(404);
    next();
  });
  router.get('/:id', (req, res) => {
    const base = `${prefix}/${req.params.id}`;
    const query = new URLSearchParams({ autoconnect: '1', path: `${base.slice(1)}/websockify` });
    res.redirect(`${base}/vnc.html?${query}`);
  });
  router.use('/:id', assets);

  async function upgrade(req, client, head) {
    client.on('error', () => client.destroy());
    const match = upgradePath.exec(req.url);
    if (!match || req.headers.origin !== allowedOrigin || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      client.destroy();
      return;
    }
    try {
      req.auth = await authenticateUpgrade(req);
    } catch {
      client.destroy();
      return;
    }
    const signal = sessions.viewerSignal(req, match[1]);
    if (!signal || signal.aborted || client.destroyed) {
      client.destroy();
      return;
    }

    const headers = { Connection: 'Upgrade', Upgrade: 'websocket' };
    for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const proxy = http.request({
      hostname: '127.0.0.1', port: websockifyPort, path: '/websockify', headers,
    });
    let upstream;
    const close = () => {
      proxy.destroy();
      upstream?.destroy();
      client.destroy();
    };
    signal.addEventListener('abort', close, { once: true });
    client.once('close', () => {
      signal.removeEventListener('abort', close);
      close();
    });
    proxy.setTimeout(5000, close);
    proxy.on('error', close);
    proxy.on('response', close);
    proxy.on('upgrade', (response, socket, initial) => {
      upstream = socket;
      upstream.setTimeout(0);
      upstream.on('error', close);
      upstream.on('close', close);
      if (client.destroyed || signal.aborted) return close();
      const lines = ['HTTP/1.1 101 Switching Protocols'];
      for (const name of ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol']) {
        if (response.headers[name]) lines.push(`${name}: ${response.headers[name]}`);
      }
      client.write(lines.join('\r\n') + '\r\n\r\n');
      if (initial.length) client.write(initial);
      if (head.length) upstream.write(head);
      upstream.pipe(client).pipe(upstream);
    });
    proxy.end();
  }

  return { router, upgrade };
}

module.exports = { createLoginViewer };
