const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSafetyUi(savedMessage, blockSource = 'prompt') {
  const script = fs.readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');
  const helperStart = script.indexOf('function showGeminiSafetyBlock(details) {');
  const helperEnd = script.indexOf('async function initializeRunCommentPrefixEditor() {', helperStart);
  const adviceStart = script.indexOf('async function getGeminiAdvice(date, maxStride, data) {');
  const adviceEnd = script.indexOf('async function applySelectedRunAdviceFromCurrentView() {', adviceStart);
  if ([helperStart, helperEnd, adviceStart, adviceEnd].some(index => index < 0)) {
    throw new Error('Gemini safety handler is missing');
  }

  const elements = {
    runCommentPrefixStatus: { textContent: '保存済み' },
    runCommentPrefixInput: { value: '入力した文章はそのまま' },
    'daily-message-container': { style: { display: 'none' } },
    'daily-message-text': { innerHTML: '', textContent: '' }
  };

  const fetch = jest.fn(async () => ({
    ok: false,
    status: 422,
    json: async () => ({
      code: 'GEMINI_SAFETY_BLOCK',
      blockReason: 'SAFETY',
      blockSource,
      error: 'Gemini blocked this request or generated response'
    })
  }));

  const context = {
    document: { getElementById: id => elements[id] || null },
    fetch,
    getSelectedAdviceRunId: () => 'run_123',
    currentRunChartSource: 'coros_fit',
    currentAdviceRunDate: '2026-11-22',
    loadRunMessage: async () => savedMessage
  };
  vm.createContext(context);
  vm.runInContext(
    script.slice(helperStart, helperEnd) + '\n' +
    script.slice(adviceStart, adviceEnd) + '\n' +
    'globalThis.testGetGeminiAdvice = getGeminiAdvice;',
    context
  );
  return { elements, fetch, getGeminiAdvice: context.testGetGeminiAdvice };
}

test('safety rejection shows by the prompt and restores a saved RUN COMMENT', async () => {
  const { elements, fetch, getGeminiAdvice } = loadSafetyUi('前回のRUN COMMENT', 'prompt');
  await getGeminiAdvice('2026-11-22', 0, []);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(elements.runCommentPrefixStatus.textContent).toContain('SAFETY');
  expect(elements.runCommentPrefixStatus.textContent).toContain('リクエスト');
  expect(elements.runCommentPrefixInput.value).toBe('入力した文章はそのまま');
  expect(elements['daily-message-container'].style.display).toBe('block');
  expect(elements['daily-message-text'].textContent).toBe('前回のRUN COMMENT');
});

test('safety rejection with no saved comment hides Apply-able content', async () => {
  const { elements, getGeminiAdvice } = loadSafetyUi(null, 'candidate');
  await getGeminiAdvice('2026-11-22', 0, []);
  expect(elements.runCommentPrefixStatus.textContent).toContain('出力');
  expect(elements.runCommentPrefixInput.value).toBe('入力した文章はそのまま');
  expect(elements['daily-message-container'].style.display).toBe('none');
  expect(elements['daily-message-text'].textContent).toBe('');
});
