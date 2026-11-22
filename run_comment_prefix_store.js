const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PATH = path.join(__dirname, 'data', 'gemini', 'run-comment-prefix.json');
const MAX_LENGTH = 8000;

function normalizePrefix(text) {
  if (typeof text !== 'string' || text.length > MAX_LENGTH) {
    const error = new Error('Prefix must be a string of at most 8000 characters');
    error.code = 'INVALID_PREFIX';
    throw error;
  }
  return text.trim();
}

async function readRunCommentPrefix(filePath = DEFAULT_PATH) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
  return normalizePrefix(data.text);
}

async function saveRunCommentPrefix(text, filePath = DEFAULT_PATH) {
  const normalized = normalizePrefix(text);
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = filePath + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify({ text: normalized }, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return normalized;
}

module.exports = { readRunCommentPrefix, saveRunCommentPrefix, MAX_LENGTH };
