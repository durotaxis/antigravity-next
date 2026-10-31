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

test('both failures stop after 3.7 and preserve the unavailable message', async () => {
    const generate = jest.fn().mockRejectedValue(Object.assign(new Error('quota'), { status: 429 }));
    const service = load(generate);
    expect(await service.generateAdvice({ date: '2026-10-30' })).toBe(service.TEMPORARY_UNAVAILABLE_MESSAGE);
    expect(generate).toHaveBeenCalledTimes(2);
});
