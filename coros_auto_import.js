const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');

function createCorosAutoImport({ settingsPath, scan, intervalMs = 30000, onError = console.error }) {
  let enabled;
  let initialized;
  let started = false;
  let timer = null;
  let running = null;
  let lastError = null;
  let updates = Promise.resolve();

  const initialize = () => {
    if (!initialized) initialized = (async () => {
      try {
        const settings = JSON.parse((await fs.readFile(settingsPath, 'utf8')).replace(/^\uFEFF/, ''));
        if (settings?.version !== 1 || typeof settings.enabled !== 'boolean') throw new Error('Invalid FIT auto-import setting');
        enabled = settings.enabled;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        enabled = true; // Preserve automatic import on installations without a saved preference.
      }
    })();
    return initialized;
  };
  const status = () => ({ enabled, running: Boolean(running), intervalSeconds: intervalMs / 1000, lastError });
  const run = () => {
    if (!started || !enabled || running) return;
    running = Promise.resolve().then(scan).then(() => { lastError = null; }).catch(error => {
      lastError = error?.message || String(error);
      onError(error);
    }).finally(() => { running = null; });
  };
  const schedule = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (started && enabled) {
      timer = setInterval(run, intervalMs);
      timer.unref?.();
      run();
    }
  };
  return {
    async start() {
      await initialize();
      if (started) return;
      started = true;
      schedule();
    },
    async getStatus() { await initialize(); return status(); },
    setEnabled(value) {
      if (typeof value !== 'boolean') return Promise.reject(new TypeError('enabled must be a boolean'));
      const update = updates.then(async () => {
        await initialize();
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        const temporaryPath = `${settingsPath}.tmp.${crypto.randomUUID()}`;
        try {
          await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, enabled: value, updatedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
          await fs.rename(temporaryPath, settingsPath);
        } finally { await fs.unlink(temporaryPath).catch(() => {}); }
        const changed = enabled !== value;
        enabled = value;
        if (changed) schedule();
        return status();
      });
      updates = update.catch(() => {});
      return update;
    },
    stop() {
      started = false;
      if (timer) clearInterval(timer);
      timer = null;
      return running || Promise.resolve();
    }
  };
}

function createCorosAutoImportRouter(controller) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await controller.getStatus()); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });
  router.put('/', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    try { res.json(await controller.setEnabled(req.body.enabled)); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });
  return router;
}

module.exports = { createCorosAutoImport, createCorosAutoImportRouter };
