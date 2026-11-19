import { build } from '../../frontend/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const local = relative => fileURLToPath(new URL(relative, import.meta.url));
const entry = local('./cloud-probe/traffic-task.mjs');
const adapter = local('../../../M-baoxiao/src/automation/cscec-adapter.js');

await build({
  entryPoints: [entry],
  outfile: local('./cloud-probe/traffic-bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [{
    name: 'expense-browser-binding',
    setup({ onResolve, onLoad }) {
      onResolve({ filter: /^expense-original$/ }, () => ({ path: adapter }));
      onResolve({ filter: /^\.\/browser-session\.js$/ }, args =>
        args.importer === adapter ? { path: entry } : undefined);
      onLoad({ filter: /cscec-adapter\.js$/ }, async args => {
        if (args.path !== adapter) return;
        let source = await readFile(adapter, 'utf8');
        const signature = 'export async function uploadItineraryAttachments(task) {';
        const upload = '  await fileInput.setInputFiles(paths);';
        const lookupStart = '  let fileInput = null;';
        const trafficRows = 'async function getTrafficRows(page) {';
        const start = source.indexOf(lookupStart, source.indexOf(signature));
        const uploadAt = source.indexOf(upload, start);
        if (!source.includes(signature) || start < 0 || uploadAt < start || !source.includes(trafficRows)) {
          throw new Error('原执行器附件或交通费用接口已改动，请检查云端复用绑定。');
        }
        source = source.slice(0, start) + '  await uploadFiles(paths);' + source.slice(uploadAt + upload.length);
        source = source.replace(signature, 'export async function uploadItineraryAttachments(task, uploadFiles) {');
        source += '\nexport { getTrafficRows };\n';
        return { contents: source, resolveDir: dirname(adapter) };
      });
    },
  }],
});
