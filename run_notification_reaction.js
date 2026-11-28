function extractMinuteFindings(message) {
    return String(message || '').replace(/\r\n?/g, '\n').replace(/\*\*|__/g, '')
        .match(/1分毎テーブル所見[ \t]*[:：][ \t]*(?:\n(?![ \t]*\n))?([\s\S]*?)(?=\n[ \t]*\n|\n[ \t]*#{1,6}[ \t]+|$)/u)?.[1]?.trim() || '';
}

function createNotificationReaction(generate, onError = console.warn) {
    return async messages => {
        const findings = (Array.isArray(messages) ? messages : [messages])
            .map(extractMinuteFindings).filter(text => text && text !== 'データなし');
        if (!findings.length) return '';
        try { return await generate(findings.join('\n')); }
        catch { onError('[notification] 感想を生成できなかったため、取込結果だけ通知します。'); return ''; }
    };
}

module.exports = { createNotificationReaction, extractMinuteFindings };
