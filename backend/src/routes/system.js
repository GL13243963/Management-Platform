const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { execFile } = require('child_process');
const { requireAnyRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});
const updateDir = process.env.UPDATE_DIR || '/var/lib/innovation-center/updates';
const incomingFile = path.join(updateDir, 'incoming.zip');
const statusFile = path.join(updateDir, 'status.json');

function currentVersion() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'VERSION'),
    path.join(__dirname, '..', '..', '..', 'deploy', 'VERSION'),
  ];
  for (const candidate of candidates) {
    try { return fs.readFileSync(candidate, 'utf8').trim(); } catch {}
  }
  return 'unknown';
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); }
  catch { return { state: 'idle', message: '尚未执行在线更新' }; }
}

router.get('/status', requireAnyRole('admin'), (req, res) => {
  res.json({ currentVersion: currentVersion(), update: readStatus() });
});

const requiredSystemFiles = ['VERSION', 'deploy/install.sh', 'backend/package.json', 'frontend/dist/index.html'];

function inspectSystemZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Set();
      if (zip.entryCount > 5000) {
        zip.close();
        return reject(new Error('Too many ZIP entries'));
      }
      zip.once('error', error => { zip.close(); reject(error); });
      zip.on('entry', entry => {
        files.add(entry.fileName);
        zip.readEntry();
      });
      zip.once('end', () => resolve(files));
      zip.readEntry();
    });
  });
}
router.post('/update', requireAnyRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择正式更新包' });
  if (!/\.zip$/i.test(req.file.originalname || '')) return res.status(400).json({ error: '更新包必须是 ZIP 文件' });
  if (req.file.buffer.length < 4 || req.file.buffer[0] !== 0x50 || req.file.buffer[1] !== 0x4b) {
    return res.status(400).json({ error: '文件不是有效的 ZIP 更新包' });
  }
  let files;
  try { files = await inspectSystemZip(req.file.buffer); }
  catch { return res.status(400).json({ error: '无法读取 ZIP 更新包，请检查文件是否完整' }); }
  if (files.has('TARGET-VERSION.txt') && [...files].some(file => file.startsWith('overlay/'))) {
    return res.status(400).json({
      code: 'SYSTEM_MAINTENANCE_PACKAGE',
      error: '这是主平台维护包。请在服务器按随包的发布说明暂存、验收并切换。',
    });
  }
  if (!requiredSystemFiles.every(file => files.has(file))) {
    if (files.has('manifest.json')) {
      return res.status(400).json({
        code: 'MODULE_PACKAGE_WRONG_ENTRY',
        error: '这是板块升级包，请从平台管理进入对应板块的「版本与更新」上传。',
      });
    }
    return res.status(400).json({
      code: 'SYSTEM_PACKAGE_NOT_INSTALLABLE',
      error: '该 ZIP 不支持一键系统更新，请使用带安装脚本的主平台更新包或按维护发布说明操作。',
    });
  }
  const state = readStatus();
  if (['queued', 'validating', 'installing'].includes(state.state)) {
    return res.status(409).json({ error: '已有系统更新正在进行，请稍后刷新状态' });
  }
  try {
    fs.mkdirSync(updateDir, { recursive: true });
    const temporary = `${incomingFile}.tmp`;
    fs.writeFileSync(temporary, req.file.buffer, { mode: 0o640 });
    fs.writeFileSync(statusFile, JSON.stringify({
      state: 'queued', message: '更新包已接收，等待服务器校验', fileName: path.basename(req.file.originalname), updatedAt: new Date().toISOString(),
    }));
    fs.renameSync(temporary, incomingFile);
    req.audit('system_update_requested', 'system', currentVersion(), { fileName: path.basename(req.file.originalname), bytes: req.file.size });
    execFile('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', '--no-block', 'innovation-center-update.service'], error => {
      if (!error) return;
      console.error('Failed to start system updater:', error);
      try {
        fs.writeFileSync(statusFile, JSON.stringify({
          state: 'failed', message: '更新服务未能启动，请联系管理员检查服务器权限', updatedAt: new Date().toISOString(),
        }));
      } catch (statusError) { console.error('Failed to write updater status:', statusError); }
    });
    res.status(202).json({ ok: true, message: '更新已开始。页面可能短暂断开，约1—3分钟后刷新即可。' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '更新包保存失败，请检查服务器更新目录权限' });
  }
});

module.exports = { router, currentVersion };
