const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const HISTORY_LIMIT = 100;

function fitRevision(payload) {
  const sha = String(payload.fitSha256 || '').trim().toLowerCase();
  return `fit:${sha || crypto.createHash('sha256').update(JSON.stringify(payload.chartData)).digest('hex')}`;
}

function completedImports(fitResult, inboxResult) {
  return [
    ...fitResult.imported.filter(item => item.applied && item.applied.notificationReady !== false)
      .map(item => ({ date: item.date, runId: item.labelId, revision: item.revision })),
    ...inboxResult.imported.filter(item => item.notificationReady !== false)
      .map(item => ({ date: item.date, runId: item.activityId, revision: item.revision }))
  ];
}

// This journal records successful application, independently of download timestamps.
function createCorosImportCompletions(filePath) {
  let state = { version: 1, sequence: 0, revisions: {}, events: [] };
  let initialized;
  let writes = Promise.resolve();
  const initialize = () => {
    if (!initialized) initialized = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (saved?.version !== 1 || !Number.isSafeInteger(saved.sequence) || saved.sequence < 0 ||
            !saved.revisions || typeof saved.revisions !== 'object' || Array.isArray(saved.revisions) ||
            !Object.values(saved.revisions).every(value => typeof value === 'string') ||
            !Array.isArray(saved.events) || !saved.events.every(event =>
              Number.isSafeInteger(event.sequence) && event.sequence > 0 && event.sequence <= saved.sequence &&
              /^\d{4}-\d{2}-\d{2}$/.test(event.date) && /^[A-Za-z0-9_-]+$/.test(event.runId) &&
              Number.isFinite(Date.parse(event.completedAt)))) {
          throw new Error('Invalid COROS import completion journal');
        }
        state = saved;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    })();
    return initialized;
  };
  return {
    async getSnapshot() {
      await initialize();
      return { completionSequence: state.sequence, completions: state.events.map(event => ({ ...event })) };
    },
    record(completed = []) {
      const write = writes.then(async () => {
        await initialize();
        const next = { ...state, revisions: { ...state.revisions }, events: [...state.events] };
        for (const item of completed) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !/^[A-Za-z0-9_-]+$/.test(item.runId) ||
              typeof item.revision !== 'string' || !item.revision) throw new Error('Invalid completed COROS import');
          const key = `${item.date}:${item.runId}`;
          if (next.revisions[key] === item.revision) continue;
          next.revisions[key] = item.revision;
          next.events.push({ sequence: ++next.sequence, date: item.date, runId: item.runId, completedAt: new Date().toISOString() });
        }
        if (next.sequence === state.sequence) return;
        next.events = next.events.slice(-HISTORY_LIMIT);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.tmp.${crypto.randomUUID()}`;
        try {
          await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
          await fs.rename(temporaryPath, filePath);
          state = next;
        } finally { await fs.unlink(temporaryPath).catch(() => {}); }
      });
      writes = write.catch(() => {});
      return write;
    }
  };
}

module.exports = { createCorosImportCompletions, fitRevision, completedImports };
