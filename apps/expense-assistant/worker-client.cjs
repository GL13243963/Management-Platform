const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

function createWorkerClient({ socketPath, pollMs = 1000 }) {
  if (!socketPath) throw new Error('Expense worker socket path is required');
  function request(method, id, signal, payload, material, action = '') {
    return new Promise((resolve, reject) => {
      const bodyJson = payload && JSON.stringify(payload);
      const headers = material ? { 'Content-Type': 'application/pdf', 'Content-Length': material.size }
        : bodyJson ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyJson) } : undefined;
      const suffix = material ? `/materials/${material.index}` : action;
      const req = http.request({ socketPath, path: `/desktop/${encodeURIComponent(id)}${suffix}`, method, signal, headers }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          if (method === 'DELETE' && res.statusCode === 404) return resolve({ status: 'closed' });
          if (res.statusCode !== 200) return reject(new Error(`Expense worker HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(action === '/save' ? 120_000 : 60_000, () => req.destroy(new Error('Expense worker request timed out')));
      req.on('error', reject);
      if (material) {
        const abort = () => req.destroy(new Error('Material transfer interrupted'));
        material.stream.once('aborted', abort);
        material.stream.once('error', abort);
        req.once('close', () => {
          material.stream.unpipe(req);
          material.stream.off('aborted', abort);
          material.stream.off('error', abort);
        });
        material.stream.pipe(req);
      } else {
        req.end(bodyJson);
      }
    });
  }

  return async function openBrowser({ id, task, autoSave, signal, onProgress }) {
    let initial;
    try {
      initial = await request('POST', id, signal, { task, autoSave });
    } catch (error) {
      // The worker may have received POST before the connection was interrupted.
      await request('DELETE', id).catch(() => {});
      throw error;
    }
    const ready = (async () => {
      let result = initial;
      let previous;
      const report = () => {
        for (const details of result.progress?.slice(previous || 0) || []) onProgress?.(details);
        previous = result.progress?.length || previous;
      };
      report();
      while (result.status === 'waiting') {
        await delay(pollMs, undefined, { signal });
        result = await request('GET', id, signal);
        report();
      }
      if (result.status !== 'ready') {
        const error = new Error(`Expense desktop ended with status ${result.status}`);
        error.stage = result.stage;
        error.portalDetail = result.portalDetail;
        if (result.status === 'tickets-unavailable') error.code = 'TICKETS_UNAVAILABLE';
        throw error;
      }
      return result;
    })();
    return {
      ready, close: () => request('DELETE', id),
      save: () => request('POST', id, signal, undefined, undefined, '/save'),
      upload: (index, stream, size) => request('PUT', id, signal, undefined, { index, stream, size }),
    };
  };
}

module.exports = { createWorkerClient };
