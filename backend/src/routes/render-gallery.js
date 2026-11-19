const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { hasRole } = require('../middleware/auth');
const { HIDDEN_PERSON, dashboardName } = require('../services/dashboard-visibility');
const seedItems = require('../data/render-gallery-seed.json');

const router = express.Router();
const PLATFORMS = ['Concetto', '建筑学长', 'Airilab', 'SUAPP', 'D5渲染', 'LOVART'];
const CATEGORIES = ['鸟瞰', '半鸟瞰', '人视', '室内', '分析图', '其他'];
const HIDDEN_PROJECT_STATUSES = ['placeholder', 'merged', 'deleted'];
const dbPath = process.env.APP_DB_PATH ? path.resolve(process.env.APP_DB_PATH) : null;
const uploadRoot = dbPath
  ? path.join(path.dirname(dbPath), 'uploads', 'render-gallery')
  : path.join(__dirname, '..', '..', 'uploads', 'render-gallery');
fs.mkdirSync(uploadRoot, { recursive: true });

const mimeExtensions = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename(req, file, callback) {
      callback(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${mimeExtensions.get(file.mimetype) || ''}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 2 },
  fileFilter(req, file, callback) {
    callback(mimeExtensions.has(file.mimetype) ? null : new Error('仅支持 JPG、PNG、WebP 或 GIF 图片'), mimeExtensions.has(file.mimetype));
  },
});

const seedInsert = db.prepare(`INSERT OR IGNORE INTO render_gallery_items
  (seedKey,title,imageUrl,platforms,category,prompt,legacyProjectLabel,uploaderName,createdAt)
  VALUES (@seedKey,@title,@imageUrl,@platforms,@category,@prompt,@legacyProjectLabel,@uploaderName,@createdAt)`);
db.transaction(() => seedItems.forEach(item => seedInsert.run({ ...item, platforms: JSON.stringify(item.platforms) })))();

function canUpload(user) {
  return !!user?.employeeId || hasRole(user, 'admin') || hasRole(user, 'leader') || hasRole(user, 'team_leader') || hasRole(user, 'guest');
}

function canDelete(user, item) {
  return Number(item?.uploaderUserId) === Number(user?.id) || hasRole(user, 'admin') || hasRole(user, 'leader');
}

function projectLabel(item) {
  if (item.isPractice) return '自行练习';
  return item.projectName || item.legacyProjectLabel || '';
}

function parsePlatforms(value) {
  try {
    const result = JSON.parse(value || '[]');
    return Array.isArray(result) ? result.filter(Boolean) : [];
  } catch { return []; }
}

function activeItem(id) {
  return db.prepare(`SELECT i.*, p.name AS projectName
    FROM render_gallery_items i LEFT JOIN projects p ON p.id=i.projectId
    WHERE i.id=? AND i.deletedAt IS NULL`).get(id);
}

router.get('/meta', (req, res) => {
  const projects = db.prepare(`SELECT id,name FROM projects
    WHERE status NOT IN (${HIDDEN_PROJECT_STATUSES.map(() => '?').join(',')})
    ORDER BY name COLLATE NOCASE`).all(...HIDDEN_PROJECT_STATUSES);
  res.json({ platforms: PLATFORMS, allowOtherPlatform: true, categories: CATEGORIES, projects, canUpload: canUpload(req.auth.user) });
});

router.get('/items', (req, res) => {
  const where = ['i.deletedAt IS NULL'];
  const params = { userId: req.auth.user.id };
  const platform = String(req.query.platform || '').trim();
  const category = String(req.query.category || '').trim();
  const keyword = String(req.query.q || '').trim();
  if (platform) { where.push('i.platforms LIKE @platform'); params.platform = `%${JSON.stringify(platform).slice(1, -1)}%`; }
  if (category && CATEGORIES.includes(category)) { where.push('i.category=@category'); params.category = category; }
  if (keyword) {
    where.push(`(i.title LIKE @keyword OR i.prompt LIKE @keyword OR i.uploaderName LIKE @keyword
      OR i.legacyProjectLabel LIKE @keyword OR EXISTS (SELECT 1 FROM projects p WHERE p.id=i.projectId AND p.name LIKE @keyword))`);
    params.keyword = `%${keyword}%`;
  }
  const rows = db.prepare(`SELECT i.id,i.imageUrl,i.starCount,
      EXISTS(SELECT 1 FROM render_gallery_events e WHERE e.itemId=i.id AND e.userId=@userId AND e.eventType='like') AS likedByMe
    FROM render_gallery_items i WHERE ${where.join(' AND ')}
    ORDER BY i.starCount DESC,i.createdAt DESC,i.id DESC`).all(params);
  res.json(rows.map(row => ({ ...row, likedByMe: !!row.likedByMe })));
});

router.get('/stats', (req, res) => {
  const totals = db.prepare(`SELECT COUNT(*) AS itemCount,COALESCE(SUM(starCount),0) AS starCount,
    COUNT(DISTINCT CASE WHEN TRIM(uploaderName) <> ? THEN uploaderName END) AS uploaderCount
    FROM render_gallery_items WHERE deletedAt IS NULL`).get(HIDDEN_PERSON);
  const topItems = db.prepare(`SELECT i.id,i.imageUrl,i.starCount,i.uploaderName,
      (SELECT COALESCE(SUM(authorItem.starCount),0) FROM render_gallery_items authorItem
       WHERE authorItem.deletedAt IS NULL AND authorItem.uploaderName=i.uploaderName) AS authorStarCount
    FROM render_gallery_items i
    WHERE i.deletedAt IS NULL ORDER BY i.starCount DESC,i.createdAt DESC,i.id DESC LIMIT 3`).all();
  const topUploaders = db.prepare(`SELECT uploaderName AS name,COUNT(*) AS count,
      COALESCE(SUM(starCount),0) AS starCount,
      COUNT(*)+COALESCE(SUM(starCount),0) AS score
    FROM render_gallery_items
    WHERE deletedAt IS NULL AND TRIM(uploaderName) <> ? GROUP BY uploaderName
    ORDER BY score DESC,starCount DESC,count DESC,name COLLATE NOCASE LIMIT 5`).all(HIDDEN_PERSON);
  const latestItem = db.prepare(`SELECT id,imageUrl,uploaderName,createdAt FROM render_gallery_items
    WHERE deletedAt IS NULL ORDER BY createdAt DESC,id DESC LIMIT 1`).get();
  if (latestItem) latestItem.uploaderName = dashboardName(latestItem.uploaderName);
  for (const item of topItems) {
    if (dashboardName(item.uploaderName) !== item.uploaderName) item.authorStarCount = null;
    item.uploaderName = dashboardName(item.uploaderName);
  }
  const counts = new Map(PLATFORMS.map(platform => [platform, 0]));
  for (const row of db.prepare('SELECT platforms FROM render_gallery_items WHERE deletedAt IS NULL').all()) {
    for (const platform of parsePlatforms(row.platforms)) counts.set(platform, (counts.get(platform) || 0) + 1);
  }
  const platforms = [...counts].map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform, 'zh-CN'));
  res.json({ totals, topItems, topUploaders, latestItem: latestItem || null, platforms });
});

router.get('/images/:filename', (req, res) => {
  const filename = path.basename(String(req.params.filename || ''));
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) return res.status(404).end();
  const item = db.prepare(`SELECT id FROM render_gallery_items
    WHERE (storedFilename=? OR parameterStoredFilename=?) AND deletedAt IS NULL`).get(filename, filename);
  if (!item) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filename, { root: uploadRoot });
});

router.get('/:id', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '作品不存在或已删除' });
  const likedByMe = !!db.prepare(`SELECT 1 FROM render_gallery_events
    WHERE itemId=? AND userId=? AND eventType='like'`).get(item.id, req.auth.user.id);
  res.json({
    id: item.id, title: item.title, imageUrl: item.imageUrl, parameterImageUrl: item.parameterImageUrl,
    platforms: parsePlatforms(item.platforms), category: item.category, prompt: item.prompt, project: projectLabel(item),
    uploaderName: item.uploaderName, starCount: item.starCount, createdAt: item.createdAt,
    likedByMe, canDelete: canDelete(req.auth.user, item),
  });
});

router.post('/:id/copy', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '作品不存在或已删除' });
  const add = db.transaction(() => {
    db.prepare(`INSERT INTO render_gallery_events (itemId,userId,username,eventType) VALUES (?,?,?,'copy')`)
      .run(item.id, req.auth.user.id, req.auth.user.username);
    db.prepare(`UPDATE render_gallery_items SET starCount=starCount+1,updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
    return db.prepare('SELECT starCount FROM render_gallery_items WHERE id=?').get(item.id).starCount;
  });
  const starCount = add();
  req.audit('render_prompt_copied', 'render_gallery_item', item.id, { platforms: parsePlatforms(item.platforms) });
  res.json({ starCount, added: true });
});

router.post('/:id/like', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '作品不存在或已删除' });
  const like = db.transaction(() => {
    const result = db.prepare(`INSERT OR IGNORE INTO render_gallery_events (itemId,userId,username,eventType)
      VALUES (?,?,?,'like')`).run(item.id, req.auth.user.id, req.auth.user.username);
    if (result.changes) db.prepare(`UPDATE render_gallery_items SET starCount=starCount+1,updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
    return { added: !!result.changes, starCount: db.prepare('SELECT starCount FROM render_gallery_items WHERE id=?').get(item.id).starCount };
  });
  const result = like();
  if (result.added) req.audit('render_image_liked', 'render_gallery_item', item.id, null);
  res.json({ ...result, likedByMe: true });
});

router.post('/', (req, res, next) => {
  if (!canUpload(req.auth.user)) return res.status(403).json({ error: '当前账号只能浏览作品' });
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'parameterImage', maxCount: 1 }])(req, res, error => {
    if (error) {
      const uploaded = Object.values(req.files || {}).flat();
      for (const file of uploaded) { try { fs.unlinkSync(file.path); } catch {} }
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单张图片不能超过20MB，请压缩后重试' });
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: '每次只能上传一张作品图和一张参数截图' });
      }
      return res.status(400).json({ error: error.message || '图片上传失败' });
    }
    try {
      const image = req.files?.image?.[0];
      const parameterImage = req.files?.parameterImage?.[0] || null;
      if (!image) throw new Error('请选择作品图片');
      const title = String(req.body.title || '').trim();
      let platforms;
      try { platforms = JSON.parse(req.body.platforms || '[]'); } catch { platforms = []; }
      platforms = [...new Set((Array.isArray(platforms) ? platforms : []).map(value => String(value).trim()).filter(Boolean))];
      const otherPlatform = String(req.body.otherPlatform || '').trim();
      const usesOther = platforms.includes('其他');
      platforms = platforms.filter(platform => platform !== '其他');
      if (usesOther && otherPlatform) platforms.push(otherPlatform);
      const category = String(req.body.category || '').trim();
      const prompt = String(req.body.prompt || '').trim();
      const isPractice = String(req.body.isPractice || '') === 'true';
      const projectId = isPractice ? null : Number(req.body.projectId);
      if (!title || title.length > 120) throw new Error('请填写120字以内的作品标题');
      if (!platforms.length || platforms.some(platform => !PLATFORMS.includes(platform) && platform !== otherPlatform)) throw new Error('请选择有效的生图平台');
      if (usesOther && (!otherPlatform || otherPlatform.length > 40)) throw new Error('请填写40字以内的其他平台名称');
      if (!CATEGORIES.includes(category)) throw new Error('请选择有效的图片类型');
      if (!prompt || prompt.length > 12000) throw new Error('请填写12000字以内的 Prompt');
      if (!isPractice) {
        const project = db.prepare(`SELECT id FROM projects WHERE id=? AND status NOT IN (${HIDDEN_PROJECT_STATUSES.map(() => '?').join(',')})`)
          .get(projectId, ...HIDDEN_PROJECT_STATUSES);
        if (!project) throw new Error('请选择所属项目或自行练习');
      }
      const user = req.auth.user;
      const result = db.prepare(`INSERT INTO render_gallery_items
        (title,imageUrl,storedFilename,originalFilename,mimeType,fileSize,
         parameterImageUrl,parameterStoredFilename,parameterOriginalFilename,parameterMimeType,parameterFileSize,
         platforms,category,prompt,projectId,isPractice,uploaderUserId,uploaderName)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        title, `/api/render-gallery/images/${image.filename}`, image.filename, image.originalname,
        image.mimetype, image.size,
        parameterImage ? `/api/render-gallery/images/${parameterImage.filename}` : null,
        parameterImage?.filename || null, parameterImage?.originalname || null,
        parameterImage?.mimetype || null, parameterImage?.size || null,
        JSON.stringify(platforms), category, prompt, projectId, isPractice ? 1 : 0,
        user.id, user.employee?.name || user.username,
      );
      req.audit('render_image_uploaded', 'render_gallery_item', result.lastInsertRowid, { platforms, category, projectId, isPractice, hasParameterImage: !!parameterImage });
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      for (const file of Object.values(req.files || {}).flat()) { try { fs.unlinkSync(file.path); } catch {} }
      if (error instanceof Error && !error.code) return res.status(400).json({ error: error.message });
      next(error);
    }
  });
});

router.delete('/:id', (req, res) => {
  const item = activeItem(req.params.id);
  if (!item) return res.status(404).json({ error: '作品不存在或已删除' });
  if (!canDelete(req.auth.user, item)) return res.status(403).json({ error: '只能删除自己上传的作品' });
  db.prepare(`UPDATE render_gallery_items SET deletedAt=datetime('now','localtime'),updatedAt=datetime('now','localtime') WHERE id=?`).run(item.id);
  req.audit('render_image_deleted', 'render_gallery_item', item.id, null);
  res.json({ ok: true });
});

module.exports = router;
