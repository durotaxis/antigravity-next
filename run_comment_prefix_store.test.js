jest.mock('./repo', () => ({
  getRunCommentPrefix: jest.fn(),
  saveRunCommentPrefix: jest.fn()
}));

const repo = require('./repo');
const { readRunCommentPrefix, saveRunCommentPrefix, MAX_LENGTH } = require('./run_comment_prefix_store');

beforeEach(() => {
  jest.resetAllMocks();
  repo.getRunCommentPrefix.mockResolvedValue('');
  repo.saveRunCommentPrefix.mockResolvedValue(undefined);
});

test('missing database setting means no additional prompt', async () => {
  expect(await readRunCommentPrefix()).toBe('');
  expect(repo.getRunCommentPrefix).toHaveBeenCalledTimes(1);
});

test('save and read a global UTF-8 prefix through DB (no run ID or date)', async () => {
  const text = '最大値同士を同時刻の値として扱わない。\n時系列を使うこと。';
  repo.getRunCommentPrefix.mockResolvedValue(text);
  expect(await saveRunCommentPrefix('  ' + text + '  ')).toBe(text);
  expect(repo.saveRunCommentPrefix).toHaveBeenCalledWith(text);
  expect(repo.saveRunCommentPrefix.mock.calls[0]).toHaveLength(1);
  expect(await readRunCommentPrefix()).toBe(text);
  expect(await saveRunCommentPrefix('')).toBe('');
  expect(repo.saveRunCommentPrefix).toHaveBeenLastCalledWith('');
});

test('invalid prompt cannot overwrite database setting', async () => {
  await expect(saveRunCommentPrefix('x'.repeat(MAX_LENGTH + 1))).rejects.toMatchObject({ code: 'INVALID_PREFIX' });
  await expect(saveRunCommentPrefix(null)).rejects.toMatchObject({ code: 'INVALID_PREFIX' });
  expect(repo.saveRunCommentPrefix).not.toHaveBeenCalled();
});

test('database failures propagate; no silent JSON fallback', async () => {
  repo.getRunCommentPrefix.mockRejectedValue(new Error('sqlite unavailable'));
  await expect(readRunCommentPrefix()).rejects.toThrow('sqlite unavailable');
  repo.saveRunCommentPrefix.mockRejectedValue(new Error('sqlite write failed'));
  await expect(saveRunCommentPrefix('value')).rejects.toThrow('sqlite write failed');
});

test('UI and server routes still use the same setting endpoints', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  expect(html).toContain('id="runCommentPrefixInput"');
  expect(html).toContain('id="saveRunCommentPrefixBtn"');
  expect(js).toContain("fetch('/api/gemini/run-comment-prefix'");
  expect(index).toContain('useRunCommentPrefix: true');
  expect(index).toContain('await saveRunCommentPrefix(req.body?.text)');
});
