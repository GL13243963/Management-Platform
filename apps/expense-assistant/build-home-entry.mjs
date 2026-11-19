import { build } from '../../frontend/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../frontend/', import.meta.url));
const outDir = fileURLToPath(new URL('./.home-candidate/', import.meta.url));

await build({ root, build: { outDir, emptyOutDir: true } });
