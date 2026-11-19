import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function stageMaterials(names, signal) {
  const files = new Map();
  const hashes = new Map();
  let directory;
  let writing;
  let complete;
  const ready = new Promise((resolve, reject) => {
    complete = resolve;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  ready.catch(() => {}); // The browser may still be opening when startup is cancelled.

  async function upload(index, req) {
    const name = names[index];
    if (!name) throw new Error('Unknown material');
    if (writing) throw new Error('Upload in progress');
    const length = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 5 || length > 20 * 1024 * 1024) throw new Error('Invalid PDF size');
    const abort = () => req.destroy();
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, { once: true });
    writing = (async () => {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > length) throw new Error('Invalid PDF size');
        chunks.push(chunk);
      }
      const pdf = Buffer.concat(chunks, size);
      if (size !== length || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
      signal.throwIfAborted();
      const hash = createHash('sha256').update(pdf).digest('hex');
      if (files.has(name)) {
        if (hashes.get(name) !== hash) throw new Error('Material changed within the current session');
        return;
      }
      directory ??= await mkdtemp(join(tmpdir(), 'expense-materials-'));
      const path = join(directory, name);
      await writeFile(path, pdf, { mode: 0o600 });
      files.set(name, path);
      hashes.set(name, hash);
      if (files.size === names.length) complete(files);
    })();
    try { await writing; }
    finally {
      signal.removeEventListener('abort', abort);
      writing = undefined;
    }
  }

  return {
    ready, upload,
    async close() {
      await writing?.catch(() => {});
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
