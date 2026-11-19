import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { openPortalBrowser } from './check-login.mjs';

const run = promisify(execFile);
const host = '127.0.0.1';
export const websockifyPort = 16081;
const vncPort = 15911;
const display = ':199';

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}

function connects(address) {
  return new Promise(resolve => {
    const socket = createConnection(address);
    const done = result => { socket.destroy(); resolve(result); };
    socket.once('error', () => done(false));
    socket.once('connect', () => done(true));
    socket.setTimeout(250, () => done(false));
  });
}

async function waitForProcess(processInfo, address, signal) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (processInfo.stopped) break;
    if (await connects(address) && !processInfo.stopped) return;
    await setTimeout(100, undefined, { signal });
  }
  const detail = processInfo.diagnostics.trim();
  throw new Error(`${processInfo.command} 启动失败。${detail ? `\n${detail}` : ''}`);
}

export async function openDesktop({ task, materials, autoSave, signal, onProgress, env = process.env } = {}) {
  signal?.throwIfAborted();
  if (process.platform !== 'linux') throw new Error('云端图形会话需要 Linux。');
  await Promise.all([ensurePortFree(vncPort), ensurePortFree(websockifyPort)]);
  const directory = await mkdtemp(join(env.TMPDIR || env.HOME, 'expense-desktop-'));
  const authority = join(directory, 'Xauthority');
  const desktopEnv = { ...env, DISPLAY: display, XDG_SESSION_TYPE: 'x11', XAUTHORITY: authority, TMPDIR: directory };
  delete desktopEnv.WAYLAND_DISPLAY;
  delete desktopEnv.WAYLAND_SOCKET;
  const processes = [];
  let browser;
  let closing;

  function start(command, args) {
    const child = spawn(command, args, { env: desktopEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const info = { command, child, stopped: false, diagnostics: '' };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      info.diagnostics = (info.diagnostics + chunk).slice(-3000);
    });
    info.finished = new Promise(resolve => {
      const done = () => { info.stopped = true; resolve(); };
      child.once('error', error => { info.diagnostics = error.message; done(); });
      child.once('close', done);
    });
    processes.push(info);
    return info;
  }

  function killGroup(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }

  function close() {
    return closing ??= (async () => {
      try {
        await browser?.close();
      } finally {
        for (const { child } of processes) killGroup(child, 'SIGTERM');
        await Promise.race([Promise.all(processes.map(item => item.finished)), setTimeout(1000, undefined, { ref: false })]);
        for (const { child } of processes) killGroup(child, 'SIGKILL');
        await Promise.all(processes.map(item => item.finished));
        await rm(directory, { recursive: true, force: true });
      }
    })();
  }

  try {
    await writeFile(authority, '', { mode: 0o600 });
    await run('xauth', ['-f', authority, 'add', display, '.', randomBytes(16).toString('hex')], { signal, timeout: 5000 });
    const xvfb = start('Xvfb', [display, '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-auth', authority]);
    await waitForProcess(xvfb, { path: '/tmp/.X11-unix/X199' }, signal);
    const vnc = start('x11vnc', [
      '-display', display, '-auth', authority, '-localhost', '-rfbport', String(vncPort), '-nopw', '-forever', '-nosel',
    ]);
    await waitForProcess(vnc, { host, port: vncPort }, signal);
    const websocket = start('websockify', [`${host}:${websockifyPort}`, `${host}:${vncPort}`]);
    await waitForProcess(websocket, { host, port: websockifyPort }, signal);
    browser = await openPortalBrowser({ task, materials, autoSave, signal, onProgress, env: desktopEnv });
    return { ready: browser.ready, save: browser.save, close };
  } catch (error) {
    await close();
    throw error;
  }
}
