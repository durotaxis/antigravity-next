'use client';

import { useState } from 'react';

declare global {
  interface Window {
    RunShareHtml?: {
      save(element: Element, filename: string, options?: { omit?: string; description?: string }): Promise<void>;
    };
  }
}

export default function SaveHtmlButton({ apiBase, ready }: { apiBase: string; ready: boolean }) {
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!ready) return;
    setBusy(true);
    try {
      if (!window.RunShareHtml) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `${apiBase}/run-share-html.js?v=20261122-5`;
          script.onload = () => { script.remove(); resolve(); };
          script.onerror = () => { script.remove(); reject(new Error('HTML保存機能を読み込めません。')); };
          document.head.append(script);
        });
      }
      const page = document.getElementById('run-page');
      if (!page || !window.RunShareHtml) throw new Error('画面を読み込んでから保存してください。');
      if (!page.querySelector('[id^="run-card-"]')) throw new Error('ラン一覧の読み込み完了後に保存してください。');
      for (const chart of page.querySelectorAll('[data-export-chart-values]')) {
        const values = JSON.parse(chart.getAttribute('data-export-chart-values') || '[]');
        if (!values.length) throw new Error('指定期間にグラフのデータがありません。Chart Start Dateを確認してください。');
        const dots = chart.querySelector('.recharts-line-dots')?.querySelectorAll('.recharts-dot');
        if (dots?.length !== values.length) throw new Error('グラフの描画完了後に保存してください。');
      }
      const remainingCards = Array.from(page.querySelectorAll('[id^="run-card-"]'))
        .slice(6)
        .map(card => `#${CSS.escape(card.id)}`);
      await window.RunShareHtml.save(page, `runs-${new Date().toISOString().slice(0, 10)}.html`, {
        omit: ['header', '.fixed', '[role="dialog"]', '[data-html-export-omit]', ...remainingCards].join(', '),
        description: 'AntiGravity Next — 表示中の推移グラフと先頭6件までのラン',
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'HTMLを保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" data-html-export-omit disabled={busy || !ready} onClick={save}
    className="ml-auto shrink-0 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
    {busy ? 'HTML作成中…' : ready ? 'HTML保存' : 'ランデータ読み込み待ち'}
  </button>;
}
