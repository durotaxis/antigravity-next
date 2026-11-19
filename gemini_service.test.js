const fs = require('fs');
const vm = require('vm');

function load(generateContent) {
    const sandbox = {
        require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === '@google/genai') return { GoogleGenAI: class {
                constructor() { this.models = { generateContent }; }
            } };
            return require(name);
        },
        process: { env: { GEMINI_API_KEY: 'test-key' } },
        console: { log() {}, warn() {}, error() {} },
        Buffer,
        AbortController,
        setTimeout,
        clearTimeout,
        module: { exports: {} }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./gemini_service'), 'utf8'), sandbox);
    return sandbox.module.exports;
}

test('new SDK preserves text/image parts and starts with 3.8 Flash', async () => {
    const generate = jest.fn().mockResolvedValue({ text: '  チャート所見: テスト  ' });
    const service = load(generate);
    expect(await service.generateTrendChartAdvice({ chartImageDataUrl: 'data:image/png;base64,YQ==' }))
        .toBe('チャート所見: テスト');
    const request = generate.mock.calls[0][0];
    expect(request.model).toBe('gemini-3.8-flash');
    expect(request.contents[0].role).toBe('user');
    expect(request.contents[0].parts[0].text).toContain('ランニング');
    expect(request.contents[0].parts[1]).toEqual({ inlineData: { data: 'YQ==', mimeType: 'image/png' } });
});

test('generation error switches to 3.7 and records the successful model', async () => {
    const generate = jest.fn().mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
        .mockResolvedValueOnce({ text: 'コメント' });
    const result = await load(generate).generateCorosRunComment({ date: '2026-10-30' });
    expect(result).toEqual({ message: 'コメント', model: 'gemini-3.7-flash' });
    expect(generate.mock.calls.map(([request]) => request.model)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash']);
});

test('3.8 and 3.7 failures switch to 3.6 and record the successful model', async () => {
    const generate = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
        .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
        .mockResolvedValueOnce({ text: 'コメント' });
    const result = await load(generate).generateCorosRunComment({ date: '2026-10-30' });
    expect(result).toEqual({ message: 'コメント', model: 'gemini-3.6-flash' });
    expect(generate.mock.calls.map(([request]) => request.model))
        .toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
});

test('all failures stop after 3.6 and preserve the unavailable message', async () => {
    const generate = jest.fn().mockRejectedValue(Object.assign(new Error('quota'), { status: 429 }));
    const service = load(generate);
    expect(await service.generateAdvice({ date: '2026-10-30' })).toBe(service.TEMPORARY_UNAVAILABLE_MESSAGE);
    expect(generate).toHaveBeenCalledTimes(3);
});

test('3.8 waits up to 60 seconds then aborts and uses 3.7, ignoring a late 3.8 response', async () => {
    jest.useFakeTimers();
    try {
        let finish38;
        const generate = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish38 = resolve; }))
            .mockResolvedValueOnce({ text: '3.7 comment' });
        const pending = load(generate).generateCorosRunComment({ date: '2026-10-30' });
        await jest.advanceTimersByTimeAsync(59999);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(await pending).toEqual({ message: '3.7 comment', model: 'gemini-3.7-flash' });
        expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
        expect(generate.mock.calls[1][0].config.abortSignal.aborted).toBe(false);
        finish38({ text: 'late 3.8 comment' });
        await Promise.resolve();
        expect(generate).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});

test('successful 3.8 clears its deadline without a later abort or fallback', async () => {
    jest.useFakeTimers();
    try {
        const generate = jest.fn().mockResolvedValue({ text: '3.8 comment' });
        await load(generate).generateCorosRunComment({ date: '2026-10-30' });
        expect(jest.getTimerCount()).toBe(0);
        await jest.advanceTimersByTimeAsync(120000);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0].config.abortSignal.aborted).toBe(false);
    } finally { jest.useRealTimers(); }
});

test('empty SDK text is retried instead of being recorded as a successful comment', async () => {
    const generate = jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ text: ' guide ' });
    expect(await load(generate).generateCorosRunComment({ date: '2026-11-03' }))
        .toEqual({ message: 'guide', model: 'gemini-3.7-flash' });
});

test('all three pending requests are aborted at their individual deadlines', async () => {
    jest.useFakeTimers();
    try {
        const generate = jest.fn(() => new Promise(() => {}));
        const pending = load(generate).generateAdvice({ date: '2026-11-03' });
        await jest.advanceTimersByTimeAsync(180000);
        expect(await pending).toBe('AI Analysis is currently unavailable.');
        expect(generate).toHaveBeenCalledTimes(3);
        expect(generate.mock.calls.every(([request]) => request.config.abortSignal.aborted)).toBe(true);
    } finally { jest.useRealTimers(); }
});

test('OCR keeps the configured model, image MIME, prompt and numeric conversion with the new SDK', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '{"step_count":"1000","total_distance_km":1}' });
    const sandbox = { __dirname, module: { exports: {} }, process: { env: { GEMINI_API_KEY: 'test', GEMINI_VISION_OCR_MODEL: 'configured-ocr' } },
        require(name) {
            if (name === 'fs') return { promises: { readFile: async () => Buffer.from('a') } };
            if (name === '@google/genai') return { GoogleGenAI: class { constructor() { this.models = { generateContent }; } } };
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./gemini_vision_ocr_service'), 'utf8'), sandbox);
    const result = await sandbox.module.exports.analyzeImage('example.png');
    expect(result.step_count).toBe(1000);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe('configured-ocr');
    expect(request.contents[0].parts[0].text).toContain('Return ONLY valid JSON');
    expect(request.contents[0].parts[1].inlineData).toEqual({ data: 'YQ==', mimeType: 'image/png' });
});
