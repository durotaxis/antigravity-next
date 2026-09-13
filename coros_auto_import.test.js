const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createCorosAutoImport, createCorosAutoImportRouter } = require('./coros_auto_import');

describe('FIT automatic import control', () => {
  let root, controllers;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-auto-import-'));
    controllers = [];
    jest.useFakeTimers();
  });
  afterEach(async () => {
    for (const controller of controllers) await controller.stop();
    jest.useRealTimers();
    await fs.rm(root, { recursive: true, force: true });
  });
  function create(options = {}) {
    const scan = options.scan || jest.fn().mockResolvedValue(undefined);
    const controller = createCorosAutoImport({ settingsPath: path.join(root, 'settings.json'), scan, onError: jest.fn(), ...options });
    controllers.push(controller);
    return { controller, scan };
  }
  test('default ON: immediate start and 30-second interval', async () => {
    const { controller, scan } = create();
    await controller.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30000);
    expect(scan).toHaveBeenCalledTimes(2);
  });
  test('OFF persists across restart; ON runs immediately; repeated ON does not retrigger', async () => {
    const first = create();
    await first.controller.setEnabled(false);
    await first.controller.start();
    await first.controller.stop();
    const second = create();
    await second.controller.start();
    await jest.advanceTimersByTimeAsync(90000);
    expect(second.scan).not.toHaveBeenCalled();
    await second.controller.setEnabled(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(second.scan).toHaveBeenCalledTimes(1);
    await second.controller.setEnabled(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(second.scan).toHaveBeenCalledTimes(1);
  });
  test('OFF lets an active pass finish; ON during that pass never overlaps', async () => {
    let finish;
    const scan = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const { controller } = create({ scan });
    await controller.start();
    await jest.advanceTimersByTimeAsync(0);
    await controller.setEnabled(false);
    expect(await controller.getStatus()).toMatchObject({ enabled: false, running: true });
    await jest.advanceTimersByTimeAsync(60000);
    expect(scan).toHaveBeenCalledTimes(1);
    await controller.setEnabled(true);
    await jest.advanceTimersByTimeAsync(30000);
    expect(scan).toHaveBeenCalledTimes(1);
    await controller.setEnabled(false);
    finish();
    await jest.advanceTimersByTimeAsync(90000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(await controller.getStatus()).toMatchObject({ enabled: false, running: false });
  });
  test('failed scan releases the running flag and recovers on the next interval', async () => {
    const scan = jest.fn().mockRejectedValueOnce(new Error('test failure')).mockResolvedValue(undefined);
    const { controller } = create({ scan });
    await controller.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(await controller.getStatus()).toMatchObject({ running: false, lastError: 'test failure' });
    await jest.advanceTimersByTimeAsync(30000);
    expect(await controller.getStatus()).toMatchObject({ lastError: null });
  });
  test('invalid saved configuration does not silently enable imports', async () => {
    await fs.writeFile(path.join(root, 'settings.json'), '{broken');
    const { controller, scan } = create();
    await expect(controller.start()).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(60000);
    expect(scan).not.toHaveBeenCalled();
  });
  test('failed settings write preserves the previous enabled state', async () => {
    const { controller } = create();
    await controller.setEnabled(false);
    await fs.unlink(path.join(root, 'settings.json'));
    await fs.mkdir(path.join(root, 'settings.json'));
    await expect(controller.setEnabled(true)).rejects.toThrow();
    expect((await controller.getStatus()).enabled).toBe(false);
  });
  test('API reads state, persists booleans and rejects ambiguous values', async () => {
    jest.useRealTimers();
    const { controller } = create();
    const app = express();
    app.use(express.json());
    app.use('/api/coros-auto-import', createCorosAutoImportRouter(controller));
    const initial = await request(app).get('/api/coros-auto-import').expect(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    await request(app).put('/api/coros-auto-import').send({ enabled: 'false' }).expect(400);
    const saved = await request(app).put('/api/coros-auto-import').send({ enabled: false }).expect(200);
    expect(saved.body.enabled).toBe(false);
    expect((await request(app).get('/api/coros-auto-import')).body.enabled).toBe(false);
  });
});
