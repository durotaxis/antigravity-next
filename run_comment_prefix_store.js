const repo = require('./repo');

const MAX_LENGTH = 8000;

function normalizePrefix(text) {
  if (typeof text !== 'string' || text.length > MAX_LENGTH) {
    const error = new Error('Prefix must be a string of at most 8000 characters');
    error.code = 'INVALID_PREFIX';
    throw error;
  }
  return text.trim();
}

// The database row is the only source of truth. No run_id, date or message reference.
async function readRunCommentPrefix() {
  return normalizePrefix(await repo.getRunCommentPrefix());
}

async function saveRunCommentPrefix(text) {
  const normalized = normalizePrefix(text);
  await repo.saveRunCommentPrefix(normalized);
  return normalized;
}

module.exports = { readRunCommentPrefix, saveRunCommentPrefix, MAX_LENGTH };
