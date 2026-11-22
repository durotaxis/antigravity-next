const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { readRunCommentPrefix, saveRunCommentPrefix, MAX_LENGTH } = require('./run_comment_prefix_store');

let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-comment-prefix-'));
  file = path.join(dir, 'settings.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test('missing file means no additional instructions', async () => {
  expect(await readRunCommentPrefix(file)).toBe('');
});

test('saved prompt is persisted as UTF-8 and can be cleared', async () => {
  const text = '最大値同士を同時刻の値として扱わない。\n時系列を使うこと。';
  expect(await saveRunCommentPrefix(text, file)).toBe(text);
  expect(await readRunCommentPrefix(file)).toBe(text);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ text });
  expect(await saveRunCommentPrefix('', file)).toBe('');
  expect(await readRunCommentPrefix(file)).toBe('');
});

test('invalid or oversized prefix is rejected without overwriting the saved value', async () => {
  await saveRunCommentPrefix('保存済み', file);
  await expect(saveRunCommentPrefix('x'.repeat(MAX_LENGTH + 1), file)).rejects.toMatchObject({ code: 'INVALID_PREFIX' });
  await expect(saveRunCommentPrefix(null, file)).rejects.toMatchObject({ code: 'INVALID_PREFIX' });
  expect(await readRunCommentPrefix(file)).toBe('保存済み');
});

test('no original prompt mutations are needed for the editor to function', () => {
  const html = require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const js = require('fs').readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');
  const index = require('fs').readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  expect(html).toContain('id="runCommentPrefixInput"');
  expect(html).toContain('id="saveRunCommentPrefixBtn"');
  expect(js).toContain("fetch('/api/gemini/run-comment-prefix'");
  expect(index).toContain('useRunCommentPrefix: true');
});
