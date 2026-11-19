require('../src/utils/runtime').assertSupportedRuntime();

const port = Number(process.env.PORT || 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid local server PORT');
}
const app = require('../src/index');
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`V2 local server: http://127.0.0.1:${port}`);
});
server.on('error', error => {
  console.error(`V2 local server could not start: ${error.code || error.message}`);
  process.exitCode = 1;
});
