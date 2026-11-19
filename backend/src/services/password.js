const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return '密码至少需要8位';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return '密码必须同时包含字母和数字';
  return null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { validatePassword, hashPassword, verifyPassword, createSessionToken, hashSessionToken };
