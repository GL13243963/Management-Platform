const path = require('node:path');
const { showOnDashboard } = require('./dashboard-visibility');
const { DatabaseSync } = require('node:sqlite');
const { db } = require('../models');

const DAY = 86400000;
const CHINA_OFFSET = 8 * 3600000;
const ACTIVE_WINDOW = 5 * 60000;
const localDay = timestamp => Math.floor((timestamp + CHINA_OFFSET) / DAY);
const dateLabel = day => new Date(day * DAY).toISOString().slice(0, 10);
const overviewPath = '/os/v1/app-management/activity';
let lastPrunedDay;
let reportedFailure = false;

function activityStore(now) {
  const businessPath = process.env.APP_DB_PATH
    ? path.resolve(process.env.APP_DB_PATH)
    : path.join(__dirname, '../../data/app.db');
  const connection = new DatabaseSync(businessPath + '.activity.sqlite');
  try {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS coverage (id INTEGER PRIMARY KEY CHECK (id = 1), startedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS visits (
        day INTEGER NOT NULL, userId INTEGER NOT NULL, sessionId TEXT NOT NULL,
        lastSeen INTEGER NOT NULL, PRIMARY KEY (day, userId, sessionId)
      );
    `);
    connection.prepare('INSERT OR IGNORE INTO coverage VALUES (1, ?)').run(now);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function recordActivity(userId, sessionId, now = Date.now()) {
  const connection = activityStore(now);
  try {
    const day = localDay(now);
    if (lastPrunedDay !== day) {
      connection.prepare('DELETE FROM visits WHERE day < ?').run(day - 14);
      lastPrunedDay = day;
    }
    connection.prepare(`
      INSERT INTO visits (day, userId, sessionId, lastSeen) VALUES (?, ?, ?, ?)
      ON CONFLICT(day, userId, sessionId) DO UPDATE SET lastSeen = MAX(lastSeen, excluded.lastSeen)
    `).run(day, userId, sessionId, now);
  } finally {
    connection.close();
  }
}

function trackActivity(req, res, next) {
  if (req.path.replace(/\/+$/, '').toLowerCase() !== overviewPath && req.method !== 'OPTIONS') {
    const { user, sessionId } = req.auth;
    res.once('finish', () => {
      if (res.statusCode >= 400) return;
      try {
        recordActivity(user.id, sessionId);
        reportedFailure = false;
      } catch (error) {
        if (!reportedFailure) console.error('Platform activity storage unavailable:', error.code || error.name);
        reportedFailure = true;
      }
    });
  }
  next();
}

function summarize(connection, now) {
  const { startedAt } = connection.prepare('SELECT startedAt FROM coverage WHERE id = 1').get();
  const today = localDay(now);
  const yesterday = today - 1;
  const monday = today - (new Date(today * DAY).getUTCDay() + 6) % 7;
  const weekStart = monday - 7;
  const isCovered = day => startedAt <= day * DAY - CHINA_OFFSET;
  const count = connection.prepare('SELECT COUNT(DISTINCT userId) AS total FROM visits WHERE day BETWEEN ? AND ?');
  const getCount = (first, last = first) => isCovered(first) ? count.get(first, last).total : null;

  const recent = connection.prepare(`
    SELECT userId, sessionId, MAX(lastSeen) AS lastSeen FROM visits
    WHERE day >= ? AND lastSeen >= ? GROUP BY userId, sessionId ORDER BY lastSeen DESC, userId ASC
  `).all(localDay(now - ACTIVE_WINDOW), now - ACTIVE_WINDOW);
  const liveSession = db.prepare(`
    SELECT u.username, e.name FROM sessions s JOIN users u ON u.id = s.userId
    LEFT JOIN employees e ON e.id = u.employeeId
    WHERE s.id = ? AND u.id = ? AND s.expiresAt > ? AND u.active = 1
  `);
  const active = new Map();
  const timestamp = new Date(now).toISOString();
  for (const row of recent) {
    if (active.has(row.userId)) continue;
    const user = liveSession.get(row.sessionId, row.userId, timestamp);
    if (user && showOnDashboard(user.name) && showOnDashboard(user.username)) active.set(row.userId, { ...user, lastSeen: new Date(row.lastSeen).toISOString() });
  }
  return {
    asOf: timestamp,
    activeUsers: Array.from(active.values()),
    yesterday: { date: dateLabel(yesterday), count: getCount(yesterday) },
    lastWeek: {
      start: dateLabel(weekStart), end: dateLabel(monday - 1), count: getCount(weekStart, monday - 1),
      days: Array.from({ length: 7 }, (_, index) => {
        const day = weekStart + index;
        return { date: dateLabel(day), count: getCount(day) };
      }),
    },
  };
}

function readOverview(now = Date.now()) {
  const connection = activityStore(now);
  try {
    return summarize(connection, now);
  } finally {
    connection.close();
  }
}

module.exports = { trackActivity, readOverview, recordActivity };
