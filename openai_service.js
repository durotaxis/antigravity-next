require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MAX_IMAGES = Math.max(0, Math.min(3, Number(process.env.OPENAI_MAX_ADVICE_IMAGES || 2)));

async function imagePathToDataUrl(filePath) {
  const abs = path.resolve(filePath);
  const data = await fs.readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function generateCoachMessage(maxStats, imagePaths = []) {
  if (!OPENAI_API_KEY) return 'No API Key';

  const parts = [
    {
      type: 'text',
      text: [
        'You are a running coach.',
        'Use only the provided max metrics and image evidence.',
        'Return one short Japanese message (about 80-140 chars).',
        `Date: ${maxStats.date || '-'}`,
        `Step Count: ${maxStats.stepCount || '-'}`,
        `Total Distance(km): ${maxStats.totalDistanceKm || '-'}`,
        `Total Time: ${maxStats.totalTime || '-'}`,
        `Avg Stride(cm): ${maxStats.avgStride || '-'}`,
        `Max Stride(cm): ${maxStats.maxStride || '-'}`,
        `Avg HR(bpm): ${maxStats.avgHR || '-'}`,
        `Max HR(bpm): ${maxStats.maxHR || '-'}`,
        `Avg Cadence(spm): ${maxStats.avgCadence || '-'}`,
        `Max Cadence(spm): ${maxStats.maxCadence || '-'}`,
        `Avg Speed(km/h): ${maxStats.avgSpeed || '-'}`,
        `Max Speed(km/h): ${maxStats.maxSpeed || '-'}`
      ].join('\n')
    }
  ];

  const limited = Array.isArray(imagePaths) ? imagePaths.slice(0, OPENAI_MAX_IMAGES) : [];
  for (const p of limited) {
    try {
      const dataUrl = await imagePathToDataUrl(p);
      parts.push({
        type: 'image_url',
        image_url: { url: dataUrl }
      });
    } catch {
      // ignore unreadable image
    }
  }

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.5,
    max_tokens: 220,
    messages: [
      {
        role: 'user',
        content: parts
      }
    ]
  };

  const res = await axios.post(OPENAI_API_URL, body, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const message = res?.data?.choices?.[0]?.message?.content;
  return String(message || '').trim() || 'AI message is empty.';
}

module.exports = {
  generateCoachMessage
};
