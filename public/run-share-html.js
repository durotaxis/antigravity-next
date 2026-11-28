(function (root) {
    'use strict';

    function enableChartValues() {
        const tooltip = document.createElement('div');
        tooltip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;white-space:pre-line;background:#111827;color:white;padding:10px;border:1px solid #64748b;border-radius:6px;font:13px sans-serif;max-width:85vw;display:none;';
        document.body.append(tooltip);
        document.querySelectorAll('[data-chart-values]').forEach(chart => {
            const points = JSON.parse(chart.getAttribute('data-chart-values'));
            if (!points.length) return;
            const show = event => {
                const rect = chart.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const nearest = points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
                tooltip.textContent = nearest.text;
                tooltip.style.display = 'block';
                tooltip.style.left = `${Math.max(0, Math.min(event.clientX + 12, innerWidth - tooltip.offsetWidth - 8))}px`;
                tooltip.style.top = `${Math.max(0, Math.min(event.clientY + 12, innerHeight - tooltip.offsetHeight - 8))}px`;
            };
            chart.addEventListener('pointermove', show);
            chart.addEventListener('pointerdown', show);
            chart.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
        });
    }

    function canvasValues(canvas) {
        const chart = root.Chart?.getChart(canvas);
        if (!chart) return [];
        const points = new Map();
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!chart.isDatasetVisible(datasetIndex)) return;
            const meta = chart.getDatasetMeta(datasetIndex);
            meta.data.forEach((point, index) => {
                if (point.skip || !Number.isFinite(point.x)) return;
                const value = meta.controller.getLabelAndValue(index);
                const key = point.x.toFixed(2);
                if (!points.has(key)) points.set(key, { x: point.x / chart.width, text: value.label });
                points.get(key).text += `\n${dataset.label || ''}: ${value.value}`;
            });
        });
        return [...points.values()];
    }

    function chartPoints(holder) {
        const values = JSON.parse(holder.getAttribute('data-export-chart-values') || '[]');
        if (!values.length) throw new Error('指定期間にグラフのデータがありません。Chart Start Dateを確認してください。');
        // Legend icons also use recharts-surface; only inspect the actual chart.
        const svg = holder.querySelector('.recharts-wrapper > svg.recharts-surface');
        const rect = svg?.getBoundingClientRect();
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) throw new Error('グラフの描画完了後に保存してください。');
        const points = new Map();
        svg.querySelectorAll('[data-export-point-index]').forEach(dot => {
            const index = Number(dot.getAttribute('data-export-point-index'));
            if (!Number.isInteger(index) || index < 0 || index >= values.length) return;
            const bounds = dot.getBoundingClientRect();
            const x = (bounds.left + bounds.width / 2 - rect.left) / rect.width;
            if (Number.isFinite(x)) points.set(index, { x, text: values[index] });
        });
        if (points.size !== values.length) throw new Error('グラフの描画完了後に保存してください。');
        return [...points.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
    }

    async function save(element, filename, options = {}) {
        if (!element) throw new Error('保存する画面がありません。');
        const closedDetails = [...element.querySelectorAll('details:not([open])')];
        closedDetails.forEach(details => { details.open = true; });
        try {
            const copy = element.cloneNode(true);
            const originals = [element, ...element.querySelectorAll('*')];
            const copies = [copy, ...copy.querySelectorAll('*')];
            const images = [];
            for (let index = 0; index < originals.length; index++) {
                const source = originals[index];
                const target = copies[index];
                if (source.closest(options.omit || '[data-html-export-omit]') ||
                    source.matches('script,link,style,iframe,button,input,select,textarea')) {
                    target.remove();
                    continue;
                }
                const style = getComputedStyle(source);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    target.remove();
                    continue;
                }
                // Hundreds of SVG points do not need hundreds of HTML layout properties each.
                // Keep the SVG presentation properties; its geometry remains in attributes.
                const styleNames = source.namespaceURI === 'http://www.w3.org/2000/svg' && source.tagName.toLowerCase() !== 'svg'
                    ? ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
                        'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family',
                        'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
                        'visibility', 'display', 'paint-order', 'vector-effect', 'overflow']
                    : style;
                for (const name of styleNames) {
                    const value = style.getPropertyValue(name);
                    if (!value.includes('url(')) target.style.setProperty(name, value);
                }
                for (const attribute of [...target.attributes]) {
                    if (/^on/i.test(attribute.name)) target.removeAttribute(attribute.name);
                }
                target.removeAttribute('srcset');
                if (source.tagName === 'DETAILS') {
                    target.open = true;
                    target.style.height = 'auto';
                    target.style.maxHeight = 'none';
                    target.style.overflow = 'visible';
                }
                if (source.matches('.data-table-container')) {
                    target.style.height = 'auto';
                    target.style.maxHeight = 'none';
                }
                if (source.tagName === 'CANVAS') {
                    const image = document.createElement('img');
                    image.src = source.toDataURL('image/png');
                    image.style.cssText = target.style.cssText;
                    image.style.maxWidth = '100%';
                    image.style.height = 'auto';
                    image.alt = source.getAttribute('aria-label') || 'Run chart';
                    image.setAttribute('data-chart-values', JSON.stringify(canvasValues(source)));
                    target.replaceWith(image);
                }
                if (source.tagName.toLowerCase() === 'svg') {
                    const holder = source.matches('svg.recharts-surface') && source.parentElement?.classList.contains('recharts-wrapper')
                        ? source.closest('[data-export-chart-values]') : null;
                    if (holder) {
                        const points = chartPoints(holder);
                        target.setAttribute('data-chart-values', JSON.stringify(points));
                    }
                }
                if (source.tagName === 'IMG') {
                    images.push((async () => {
                        const response = await fetch(source.currentSrc || source.src);
                        if (!response.ok) throw new Error('画像を取得できませんでした。');
                        const blob = await response.blob();
                        target.src = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error('画像を埋め込めませんでした。'));
                            reader.readAsDataURL(blob);
                        });
                        target.removeAttribute('loading');
                    })());
                }
            }
            closedDetails.forEach(details => { details.open = false; });
            await Promise.all(images);
            if (options.message !== undefined) {
                const message = copy.querySelector('#daily-message-text');
                if (message) message.textContent = options.message;
            }
            const documentCopy = document.implementation.createHTMLDocument('Run report');
            documentCopy.documentElement.lang = 'ja';
            const charset = documentCopy.createElement('meta');
            charset.setAttribute('charset', 'utf-8');
            documentCopy.head.prepend(charset);
            const viewport = documentCopy.createElement('meta');
            viewport.name = 'viewport';
            viewport.content = 'width=device-width, initial-scale=1';
            documentCopy.head.append(viewport);
            documentCopy.body.style.cssText = 'margin:0;overflow-wrap:anywhere;';
            documentCopy.body.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
            const info = documentCopy.createElement('p');
            info.textContent = `${options.description || 'Run report'} — ${new Date().toLocaleString('ja-JP')}`;
            info.style.cssText = 'padding:16px;margin:0;background:#fff;color:#172334;font:14px sans-serif;';
            documentCopy.body.append(info, copy);
            const interaction = documentCopy.createElement('script');
            interaction.textContent = `(${enableChartValues.toString()})();`;
            documentCopy.body.append(interaction);
            const blob = new Blob(['<!DOCTYPE html>\n', documentCopy.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } finally {
            closedDetails.forEach(details => { details.open = false; });
        }
    }

    root.RunShareHtml = { save, chartPoints };
})(globalThis);
