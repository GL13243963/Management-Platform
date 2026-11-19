const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { hasRole } = require('../middleware/auth');
const { HIDDEN_PERSON, dashboardName } = require('../services/dashboard-visibility');
const seedItems = require('../data/tool-matrix-seed.json');

const router = express.Router();
const TYPES = ['Agent Skill', '编辑器插件', '小程序', '小软件', '自动化流', '数据集', '模板资源'];
const SOURCES = ['团队自研', '团队改进版', '开源项目', '第三方工具'];
const SCENES = ['设计创作', 'AI 生图', '文本与知识', '数据采集', '数据处理', '项目管理', '文件处理', '效率办公', '开发运维'];
const INTERNAL_SOURCES = new Set(['团队自研', '团队改进版']);
const dbPath = process.env.APP_DB_PATH ? path.resolve(process.env.APP_DB_PATH) : null;
const uploadRoot = dbPath
  ? path.join(path.dirname(dbPath), 'uploads', 'tool-matrix')
  : path.join(__dirname, '..', '..', 'uploads', 'tool-matrix');
fs.mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename(req, file, callback) {
      const extension = path.extname(file.originalname || '').toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${extension}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = new Set(['.zip', '.7z', '.rar', '.skill', '.vsix', '.exe', '.msi', '.dmg', '.pkg', '.appimage', '.apk']);
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(allowed.has(extension) ? null : new Error('文件格式不支持，请上传常用压缩包、Skill、插件包或安装程序'), allowed.has(extension));
  },
});

const seedInsert = db.prepare(`INSERT OR IGNORE INTO tool_matrix_items
  (seedKey,name,englishName,icon,type,source,scene,summary,functionDescription,usageSteps,
   versionDescription,officialUrl,developerName,contributorName)
  VALUES (@seedKey,@name,@englishName,@icon,@type,@source,@scene,@summary,@functionDescription,@usageSteps,
   @versionDescription,@officialUrl,@developerName,@contributorName)`);
db.transaction(() => seedItems.forEach(item => seedInsert.run({ ...item, usageSteps: JSON.stringify(item.usageSteps) })))();

function displayName(user) { return user?.employee?.name || user?.username || ''; }
function isPrivileged(user) { return hasRole(user, 'admin') || hasRole(user, 'leader'); }
function canSubmit(user) { return !!user?.employeeId || isPrivileged(user) || hasRole(user, 'team_leader') || hasRole(user, 'guest'); }
function splitNames(value) { return String(value || '').split(/[、,，;；/]/).map(item => item.trim()).filter(Boolean); }
function canManage(user, item) {
  if (!user || !item) return false;
  if (isPrivileged(user)) return true;
  if (Number(item.contributorUserId) === Number(user.id) || Number(item.developerUserId) === Number(user.id)) return true;
  const name = displayName(user);
  return splitNames(item.contributorName).includes(name) || (item.source === '团队自研' && splitNames(item.developerName).includes(name));
}
function parseSteps(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function activeItem(id) { return db.prepare('SELECT * FROM tool_matrix_items WHERE id=? AND deletedAt IS NULL').get(id); }
function serialize(item, user) {
  return {
    id: item.id, name: item.name, englishName: item.englishName || '', icon: item.icon || item.name.slice(0, 1),
    type: item.type, source: item.source, scene: item.scene, summary: item.summary,
    functionDescription: item.functionDescription, usageSteps: parseSteps(item.usageSteps),
    versionDescription: item.versionDescription || '', officialUrl: item.officialUrl || '',
    packageName: item.originalFilename || '', developerUserId: item.developerUserId || null, developerName: item.developerName || '',
    contributorName: item.contributorName, useCount: item.useCount, favoriteCount: item.favoriteCount,
    heat: Number(item.useCount || 0) + Number(item.favoriteCount || 0) * 3,
    createdAt: item.createdAt, canManage: canManage(user, item),
  };
}
function validateUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; }
}
function readPayload(req, existing = null) {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const type = String(body.type || '').trim();
  const source = String(body.source || '').trim();
  const scene = String(body.scene || '').trim();
  const summary = String(body.summary || '').trim();
  const functionDescription = String(body.functionDescription || '').trim();
  const versionDescription = String(body.versionDescription || '').trim();
  const officialUrl = validateUrl(String(body.officialUrl || '').trim());
  const usageSteps = String(body.usageSteps || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!name || name.length > 100) throw new Error('请填写100字以内的工具名称');
  if (!TYPES.includes(type) || !SOURCES.includes(source) || !SCENES.includes(scene)) throw new Error('请选择有效的分类、来源和使用场景');
  if (!summary || summary.length > 200) throw new Error('请填写200字以内的一句话功能');
  if (!functionDescription || functionDescription.length > 5000) throw new Error('请填写5000字以内的功能介绍');
  if (!usageSteps.length || usageSteps.join('\n').length > 5000) throw new Error('请按行填写使用方法');
  if (!INTERNAL_SOURCES.has(source) && !officialUrl && !req.file && !existing?.storedFilename) {
    throw new Error('请至少填写官方链接或上传一个工具文件');
  }

  let developerUserId = null;
  let developerName = String(body.developerName || '').trim();
  if (source === '团队自研') {
    developerUserId = Number(body.developerUserId);
    const developer = db.prepare(`SELECT u.id,COALESCE(e.name,u.username) AS name FROM users u
      LEFT JOIN employees e ON e.id=u.employeeId WHERE u.id=? AND u.active=1 AND u.employeeId IS NOT NULL`).get(developerUserId);
    if (!developer) throw new Error('团队自研项目必须从团队成员中选择开发人');
    developerName = developer.name;
  } else if (source === '团队改进版' && body.developerUserId) {
    developerUserId = Number(body.developerUserId);
    const developer = db.prepare(`SELECT u.id,COALESCE(e.name,u.username) AS name FROM users u
      LEFT JOIN employees e ON e.id=u.employeeId WHERE u.id=? AND u.active=1 AND u.employeeId IS NOT NULL`).get(developerUserId);
    if (!developer) throw new Error('请选择有效的团队开发人');
    developerName = developer.name;
  }
  if (developerName.length > 120) throw new Error('开发人名称不能超过120字');
  if (INTERNAL_SOURCES.has(source) && !req.file && !existing?.storedFilename) throw new Error('自研或改进版请上传工具文件');
  return { name, englishName: String(body.englishName || '').trim().slice(0, 120), icon: String(body.icon || name.slice(0, 1)).trim().slice(0, 2), type, source, scene, summary, functionDescription, usageSteps: JSON.stringify(usageSteps), versionDescription: versionDescription.slice(0, 1000), officialUrl: officialUrl || null, developerUserId, developerName };
}

router.get('/meta', (req, res) => {
  const teamMembers = db.prepare(`SELECT u.id,COALESCE(e.name,u.username) AS name FROM users u
    JOIN employees e ON e.id=u.employeeId WHERE u.active=1 AND e.active=1 ORDER BY name COLLATE NOCASE`).all();
  res.json({ types: TYPES, sources: SOURCES, scenes: SCENES, teamMembers, canSubmit: canSubmit(req.auth.user) });
});

router.get('/items', (req, res) => {
  const where = ['deletedAt IS NULL'];
  const params = {};
  for (const key of ['type', 'source', 'scene']) {
    const value = String(req.query[key] || '').trim();
    if (value) { where.push(`${key}=@${key}`); params[key] = value; }
  }
  const q = String(req.query.q || '').trim();
  if (q) { where.push('(name LIKE @q OR summary LIKE @q OR developerName LIKE @q OR contributorName LIKE @q)'); params.q = `%${q}%`; }
  const rows = db.prepare(`SELECT * FROM tool_matrix_items WHERE ${where.join(' AND ')}
    ORDER BY (useCount+favoriteCount*3) DESC,createdAt DESC,id DESC`).all(params);
  res.json(rows.map(item => serialize(item, req.auth.user)));
});

router.get('/stats', (req, res) => {
  const totals = db.prepare(`SELECT COUNT(*) AS toolCount,COALESCE(SUM(useCount),0) AS useCount,
    COUNT(DISTINCT CASE WHEN TRIM(contributorName) <> ? THEN contributorName END) AS contributorCount
    FROM tool_matrix_items WHERE deletedAt IS NULL`).get(HIDDEN_PERSON);
  const topItems = db.prepare(`SELECT * FROM tool_matrix_items WHERE deletedAt IS NULL
    ORDER BY (useCount+favoriteCount*3) DESC,createdAt DESC,id DESC LIMIT 3`).all().map(item => serialize({
      ...item, developerName: dashboardName(item.developerName), contributorName: dashboardName(item.contributorName),
    }, req.auth.user));
  const developers = db.prepare(`SELECT developerName AS name,COUNT(*) AS count FROM tool_matrix_items
    WHERE deletedAt IS NULL AND source='团队自研' AND developerUserId IS NOT NULL AND TRIM(developerName) <> ?
    GROUP BY developerUserId,developerName ORDER BY count DESC,name COLLATE NOCASE LIMIT 5`).all(HIDDEN_PERSON);
  const contributors = db.prepare(`SELECT contributorName AS name,COUNT(*) AS count FROM tool_matrix_items
    WHERE deletedAt IS NULL AND TRIM(contributorName) <> ?
    GROUP BY contributorName ORDER BY count DESC,name COLLATE NOCASE LIMIT 5`).all(HIDDEN_PERSON);
  const usageByType = db.prepare(`SELECT type,SUM(useCount) AS count FROM tool_matrix_items WHERE deletedAt IS NULL
    GROUP BY type ORDER BY count DESC,type COLLATE NOCASE`).all();
  res.json({ totals, topItems, developers, contributors, usageByType });
});

router.get('/:id', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '工具不存在或已删除' });
  const favoritedByMe = !!db.prepare('SELECT 1 FROM tool_matrix_favorites WHERE itemId=? AND userId=?').get(item.id, req.auth.user.id);
  res.json({ ...serialize(item, req.auth.user), favoritedByMe });
});

router.post('/:id/use', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '工具不存在或已删除' });
  db.prepare(`UPDATE tool_matrix_items SET useCount=useCount+1,updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
  req.audit('tool_matrix_used', 'tool_matrix_item', item.id, { source: item.source });
  res.json({ officialUrl: item.officialUrl || '', hasPackage: !!item.storedFilename, useCount: Number(item.useCount) + 1 });
});

router.get('/:id/package', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item?.storedFilename) return res.status(404).json({ error: '该工具没有可下载文件' });
  const filename = path.basename(item.storedFilename);
  const fullPath = path.join(uploadRoot, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '工具文件暂不可用' });
  db.prepare(`UPDATE tool_matrix_items SET useCount=useCount+1,updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
  req.audit('tool_matrix_package_downloaded', 'tool_matrix_item', item.id, { filename: item.originalFilename });
  res.download(fullPath, item.originalFilename);
});

router.post('/:id/favorite', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '工具不存在或已删除' });
  const toggle = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM tool_matrix_favorites WHERE itemId=? AND userId=?').get(item.id, req.auth.user.id);
    if (existing) {
      db.prepare('DELETE FROM tool_matrix_favorites WHERE id=?').run(existing.id);
      db.prepare(`UPDATE tool_matrix_items SET favoriteCount=MAX(0,favoriteCount-1),updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
      return false;
    }
    db.prepare('INSERT INTO tool_matrix_favorites (itemId,userId) VALUES (?,?)').run(item.id, req.auth.user.id);
    db.prepare(`UPDATE tool_matrix_items SET favoriteCount=favoriteCount+1,updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
    return true;
  });
  const favorited = toggle();
  const current = activeItem(item.id);
  req.audit(favorited ? 'tool_matrix_favorited' : 'tool_matrix_unfavorited', 'tool_matrix_item', item.id, null);
  res.json({ favorited, favoriteCount: current.favoriteCount, heat: current.useCount + current.favoriteCount * 3 });
});

function handleUpload(req, res, next, updateId = null) {
  upload.single('package')(req, res, error => {
    if (error) return res.status(400).json({ error: error.message || '文件上传失败' });
    let existing = null;
    try {
      if (!canSubmit(req.auth.user)) throw new Error('当前账号只能浏览和使用工具');
      if (updateId) {
        existing = activeItem(updateId);
        if (!existing) return res.status(404).json({ error: '工具不存在或已删除' });
        if (!canManage(req.auth.user, existing)) return res.status(403).json({ error: '只有贡献人、团队开发人、VIP或管理员可以修改' });
      }
      const payload = readPayload(req, existing);
      const contributorName = existing?.contributorName || displayName(req.auth.user);
      const contributorUserId = existing?.contributorUserId || req.auth.user.id;
      if (existing) {
        db.prepare(`UPDATE tool_matrix_items SET name=@name,englishName=@englishName,icon=@icon,type=@type,
          source=@source,scene=@scene,summary=@summary,functionDescription=@functionDescription,usageSteps=@usageSteps,
          versionDescription=@versionDescription,officialUrl=@officialUrl,developerUserId=@developerUserId,
          developerName=@developerName,storedFilename=@storedFilename,originalFilename=@originalFilename,
          mimeType=@mimeType,fileSize=@fileSize,updatedAt=datetime('now','localtime') WHERE id=@id`).run({
          ...payload, id: existing.id,
          storedFilename: req.file?.filename || existing.storedFilename,
          originalFilename: req.file?.originalname || existing.originalFilename,
          mimeType: req.file?.mimetype || existing.mimeType,
          fileSize: req.file?.size || existing.fileSize,
        });
        req.audit('tool_matrix_updated', 'tool_matrix_item', existing.id, { name: payload.name });
        return res.json({ id: existing.id });
      }
      const result = db.prepare(`INSERT INTO tool_matrix_items
        (name,englishName,icon,type,source,scene,summary,functionDescription,usageSteps,versionDescription,
         officialUrl,storedFilename,originalFilename,mimeType,fileSize,developerUserId,developerName,contributorUserId,contributorName)
        VALUES (@name,@englishName,@icon,@type,@source,@scene,@summary,@functionDescription,@usageSteps,@versionDescription,
         @officialUrl,@storedFilename,@originalFilename,@mimeType,@fileSize,@developerUserId,@developerName,@contributorUserId,@contributorName)`).run({
        ...payload, storedFilename: req.file?.filename || null, originalFilename: req.file?.originalname || null,
        mimeType: req.file?.mimetype || null, fileSize: req.file?.size || null, contributorUserId, contributorName,
      });
      req.audit('tool_matrix_created', 'tool_matrix_item', result.lastInsertRowid, { name: payload.name, source: payload.source });
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      if (error instanceof Error && !error.code) return res.status(400).json({ error: error.message });
      next(error);
    }
  });
}

router.post('/', (req, res, next) => handleUpload(req, res, next));
router.put('/:id', (req, res, next) => handleUpload(req, res, next, req.params.id));

router.delete('/:id', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '工具不存在或已删除' });
  if (!canManage(req.auth.user, item)) return res.status(403).json({ error: '只有贡献人、团队开发人、VIP或管理员可以删除' });
  db.prepare(`UPDATE tool_matrix_items SET deletedAt=datetime('now','localtime'),updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
  req.audit('tool_matrix_deleted', 'tool_matrix_item', item.id, null);
  res.json({ ok: true });
});

module.exports = router;
