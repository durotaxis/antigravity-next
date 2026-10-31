(function (root) {
    'use strict';

    function raster(canvas, background = '#1a1a1a') {
        const image = document.createElement('canvas');
        image.width = canvas.width;
        image.height = canvas.height;
        const ctx = image.getContext('2d');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, image.width, image.height);
        ctx.drawImage(canvas, 0, 0);
        return image;
    }

    function tableImage(headers, rows) {
        const canvas = document.createElement('canvas');
        const width = 1600;
        const padding = 18;
        const columnWidth = width / headers.length;
        const ctx = canvas.getContext('2d');
        ctx.font = '24px Arial, sans-serif';
        const wrap = text => {
            const lines = [''];
            for (const character of String(text)) {
                if (ctx.measureText(lines[lines.length - 1] + character).width > columnWidth - padding * 2) lines.push('');
                lines[lines.length - 1] += character;
            }
            return lines;
        };
        const cells = [headers, ...rows].map(row => row.map(wrap));
        const heights = cells.map(row => Math.max(...row.map(lines => lines.length)) * 32 + padding * 2);
        canvas.width = width;
        canvas.height = heights.reduce((sum, value) => sum + value, 0);
        ctx.font = '24px Arial, sans-serif';
        ctx.textBaseline = 'top';
        let y = 0;
        cells.forEach((row, rowIndex) => {
            ctx.fillStyle = rowIndex === 0 ? '#e6edf5' : rowIndex % 2 ? '#ffffff' : '#f5f7fa';
            ctx.fillRect(0, y, width, heights[rowIndex]);
            ctx.fillStyle = '#172334';
            row.forEach((lines, column) => lines.forEach((line, index) => {
                ctx.fillText(line, column * columnWidth + padding, y + padding + index * 32);
            }));
            y += heights[rowIndex];
        });
        return canvas;
    }

    function create(snapshot) {
        if (!root.jspdf?.jsPDF) throw new Error('PDFライブラリを読み込めません。画面を再読み込みしてください。');
        if (!snapshot.charts.length) throw new Error('書き出せるグラフがありません。');
        if (!snapshot.headers.length || !snapshot.rows.length ||
            snapshot.rows.some(row => row.length !== snapshot.headers.length)) {
            throw new Error('1km表のデータがありません。表の読み込み結果を確認してください。');
        }
        const doc = new root.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
        const width = doc.internal.pageSize.getWidth();
        const height = doc.internal.pageSize.getHeight();
        const margin = 32;
        const contentWidth = width - margin * 2;
        const createdAt = new Date().toISOString();
        let first = true;
        const page = title => {
            if (!first) doc.addPage();
            first = false;
            doc.setFontSize(16);
            doc.setTextColor(23, 35, 52);
            doc.text('RUN REPORT', margin, 30);
            doc.setFontSize(9);
            doc.text(`Date: ${snapshot.date}   Run ID: ${snapshot.runId}`, margin, 48);
            doc.text(`Source: ${snapshot.source}   Exported: ${createdAt}`, margin, 62);
            doc.setFontSize(11);
            doc.text(title, margin, 85);
        };
        // Two legible landscape charts per page, with their original aspect ratios.
        snapshot.charts.forEach((chart, index) => {
            if (index % 2 === 0) page('Charts');
            const y = 110 + (index % 2) * 222;
            const image = raster(chart.canvas);
            const scale = Math.min(contentWidth / image.width, 182 / image.height);
            doc.setFontSize(11);
            doc.text(chart.title, margin, y);
            doc.addImage(image.toDataURL('image/png'), 'PNG', margin, y + 10, image.width * scale, image.height * scale);
        });
        // Paginate at row boundaries; each page repeats the column headings.
        let pending = [];
        const flush = () => {
            page(`1km Splits - ${snapshot.tableSource}`);
            const image = tableImage(snapshot.headers, pending);
            const scale = Math.min(contentWidth / image.width, (height - 130) / image.height);
            doc.addImage(image.toDataURL('image/png'), 'PNG', margin, 102, image.width * scale, image.height * scale);
            pending = [];
        };
        snapshot.rows.forEach(row => {
            const candidate = tableImage(snapshot.headers, [...pending, row]);
            if (pending.length && candidate.height * contentWidth / candidate.width > height - 130) flush();
            pending.push(row);
        });
        if (pending.length) flush();
        const count = doc.getNumberOfPages();
        for (let index = 1; index <= count; index++) {
            doc.setPage(index);
            doc.setFontSize(9);
            doc.text(`${index} / ${count}`, width - margin, height - 18, { align: 'right' });
        }
        doc.setProperties({ title: `Run ${snapshot.date} ${snapshot.runId}`, subject: 'Run charts and displayed 1km splits', creator: 'AntiGravity' });
        return doc;
    }

    root.RunSharePdf = {
        create,
        save(snapshot) {
            const doc = create(snapshot);
            const safeId = snapshot.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
            return doc.save(`${snapshot.date}_${safeId}_run-report.pdf`, { returnPromise: true });
        }
    };
})(globalThis);
