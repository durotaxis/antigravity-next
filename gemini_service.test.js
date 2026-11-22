const fs = require('fs');
const vm = require('vm');

function load(generateContent, prefix = '') {
    const sandbox = {
        require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === './run_comment_prefix_store') return { readRunCommentPrefix: async () => prefix };
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

test('3.8 waits up to 180 seconds then aborts and uses 3.7, ignoring a late 3.8 response', async () => {
    jest.useFakeTimers();
    try {
        let finish38;
        const generate = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish38 = resolve; }))
            .mockResolvedValueOnce({ text: '3.7 comment' });
        const pending = load(generate).generateCorosRunComment({ date: '2026-10-30' });
        await jest.advanceTimersByTimeAsync(179999);
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
        await jest.advanceTimersByTimeAsync(360000);
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
        await jest.advanceTimersByTimeAsync(540000);
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


test('COROS FIT chart and minute table reach Gemini; rest-placement instruction is absent', async () => {
    const generate = jest.fn().mockResolvedValue({ text: '観測結果' });
    const service = load(generate);
    const answer = await service.generateAdvice({
        date: '2026-11-22',
        avg_stride_cm: 75,
        max_stride_cm: 82,
        avg_heart_rate: 121,
        max_heart_rate: 137,
        avg_cadence: 168,
        max_cadence: 182,
        avg_speed: 8,
        max_speed: 10
    }, [], {
        chartImageDataUrl: 'data:image/png;base64,YQ==',
        minuteTableMarkdown: '## COROS FIT Per Minute\n| Time | Speed |\n| --- | --- |\n| 10:00 | 8 |',
        completeRestWindows: [],
        previousRunComment: '前回の記録'
    });
    expect(answer).toBe('観測結果');
    const parts = generate.mock.calls[0][0].contents[0].parts;
    expect(parts[1]).toEqual({ inlineData: { data: 'YQ==', mimeType: 'image/png' } });
    expect(parts[0].text).toContain('## COROS FIT Per Minute');
    expect(parts[0].text).toContain('前回のRUN COMMENT');
    expect(parts[0].text).toContain('完全休止時間帯:');
    expect(parts[0].text).not.toContain('走行構造がインターバルトレーニングと判断できる場合');
});


test('saved user prefix comes before the existing FIT RUN COMMENT prompt', async () => {
    const generate = jest.fn().mockResolvedValue({ text: 'コメント' });
    const service = load(generate, '最高値は同時発生とは限らない');
    await service.generateAdvice({
        date: '2026-11-22',
        avg_stride_cm: 70,
        max_stride_cm: 90,
        avg_heart_rate: 120,
        max_heart_rate: 140,
        avg_cadence: 160,
        max_cadence: 180,
        avg_speed: 8,
        max_speed: 10
    }, [], { useRunCommentPrefix: true, minuteTableMarkdown: '## COROS FIT Per Minute' });
    const text = generate.mock.calls[0][0].contents[0].parts[0].text;
    expect(text.startsWith('最高値は同時発生とは限らない\n\n')).toBe(true);
    expect(text).toContain('あなたはバイオメカニクス専門のランニング分析コーチです。');
    expect(text).toContain('## COROS FIT Per Minute');

    await service.generateAdvice({ date: '2026-11-22' }, [], {});
    expect(generate.mock.calls[1][0].contents[0].parts[0].text).not.toContain('最高値は同時発生とは限らない');
});

test('COROS overview comment also prepends saved user text', async () => {
    const generate = jest.fn().mockResolvedValue({ text: '概要コメント' });
    const service = load(generate, 'ユーザー入力');
    await service.generateCorosRunComment({ date: '2026-11-22' });
    const text = generate.mock.calls[0][0].contents[0].parts[0].text;
    expect(text.startsWith('ユーザー入力\n\n以下のCOROSランニング活動データ')).toBe(true);
});


test('Gemini prompt BLOCKLIST is not retried and reaches the RUN COMMENT caller as a structured error', async () => {
    const blocked = {
        promptFeedback: { blockReason: 'BLOCKLIST' },
        get text() { throw new Error('response.text must not be read after a safety block'); }
    };
    const generate = jest.fn().mockResolvedValue(blocked);
    const service = load(generate, 'テストの追加指示');
    await expect(service.generateAdvice({
        date: '2026-11-22', avg_stride_cm: 80, max_stride_cm: 95,
        avg_heart_rate: 120, max_heart_rate: 130,
        avg_cadence: 170, max_cadence: 190
    }, [], { useRunCommentPrefix: true }))
        .rejects.toMatchObject({ code: 'GEMINI_SAFETY_BLOCK', blockReason: 'BLOCKLIST', blockSource: 'prompt' });
    expect(generate).toHaveBeenCalledTimes(1);
});

test('Gemini output SAFETY with nonempty text is still blocked, without retry', async () => {
    const generate = jest.fn().mockResolvedValue({
        text: 'This content should not be saved as a RUN COMMENT',
        candidates: [{ finishReason: 'SAFETY' }]
    });
    await expect(load(generate).generateCorosRunComment({ date: '2026-11-22' }))
        .rejects.toMatchObject({ code: 'GEMINI_SAFETY_BLOCK', blockReason: 'SAFETY', blockSource: 'candidate' });
    expect(generate).toHaveBeenCalledTimes(1);
});

test('Gemini PROHIBITED_CONTENT and OTHER prompt blocks are not mistaken for empty responses', async () => {
    for (const reason of ['PROHIBITED_CONTENT', 'OTHER']) {
        const generate = jest.fn().mockResolvedValue({ promptFeedback: { blockReason: reason } });
        await expect(load(generate).generateCorosRunComment({ date: '2026-11-22' }))
            .rejects.toMatchObject({ code: 'GEMINI_SAFETY_BLOCK', blockReason: reason, blockSource: 'prompt' });
        expect(generate).toHaveBeenCalledTimes(1);
    }
});

test('an unspecified block reason does not suppress the existing empty-response fallback', async () => {
    const generate = jest.fn()
        .mockResolvedValueOnce({ promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' }, text: '' })
        .mockResolvedValueOnce({ text: '通常コメント' });
    expect(await load(generate).generateCorosRunComment({ date: '2026-11-22' }))
        .toEqual({ message: '通常コメント', model: 'gemini-3.7-flash' });
    expect(generate).toHaveBeenCalledTimes(2);
});

test('non-safety HTTP 400 errors are not incorrectly labeled a safety block', async () => {
    const generate = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid arguments'), { status: 400 }))
        .mockResolvedValueOnce({ text: '通常コメント' });
    expect(await load(generate).generateCorosRunComment({ date: '2026-11-22' }))
        .toEqual({ message: '通常コメント', model: 'gemini-3.7-flash' });
    expect(generate).toHaveBeenCalledTimes(2);
});
