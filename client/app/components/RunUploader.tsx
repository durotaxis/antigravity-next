'use client';

import { useState } from 'react';

function getApiBase(): string {
    const envBase = (process.env.NEXT_PUBLIC_API_URL || '').trim();
    if (envBase) return envBase;
    if (typeof window !== 'undefined') {
        const { protocol, hostname } = window.location;
        return `${protocol}//${hostname}:3000`;
    }
    return 'http://localhost:3000';
}

export default function RunUploader() {
    const API_BASE = getApiBase();
    const [isUploading, setIsUploading] = useState(false);
    const [runDate, setRunDate] = useState(() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    });

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!runDate) {
            alert('走行日を選択してください。');
            e.target.value = '';
            return;
        }

        setIsUploading(true);
        const formData = new FormData();
        formData.append('image', file);
        formData.append('date', runDate);
        // New screen upload is defined to use Python OCR path.
        formData.append('ocr_mode', 'python');

        try {
            const res = await fetch(`${API_BASE}/api/analyze`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                if (res.status === 422 && errData?.code === 'MISSING_RUN_DATE') {
                    alert('画像から日付を特定できなかったため、取り込みはキャンセルしました。');
                    setIsUploading(false);
                    e.target.value = '';
                    return;
                }
                throw new Error(errData.error || `Upload failed: ${res.statusText}`);
            }

            const data = await res.json();
            if (data?.data?.duplicate_upload) {
                alert('同じ画像は既に取り込み済みです。既存データを再利用しました。');
                setIsUploading(false);
                e.target.value = '';
                window.location.reload();
                return;
            }

            if (data?.data?.ocr_failed) {
                alert('OCRに失敗しましたが、画像の取り込みは完了しました。回復後に再度お試しください。');
                setIsUploading(false);
                e.target.value = '';
                return;
            }

            window.location.reload();
        } catch (err: unknown) {
            console.error('Error uploading:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            alert(`Analysis failed: ${message}`);
            setIsUploading(false);
            e.target.value = '';
        }
    };

    const analyzerUrl = `${API_BASE}/?date=${encodeURIComponent(runDate)}`;

    return (
        <div className="mb-6">
            <div className="mb-3 flex items-center gap-3">
                <label htmlFor="run-date" className="text-sm font-medium text-gray-600">走行日</label>
                <input
                    id="run-date"
                    type="date"
                    value={runDate}
                    onChange={(e) => setRunDate(e.target.value)}
                    disabled={isUploading}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-white"
                />
                <div className="ml-auto flex items-center gap-2">
                    <a
                        href={analyzerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-100"
                    >
                        Open Run Analyzer
                    </a>
                </div>
            </div>
            <div className="mb-3">
                <span className="inline-flex items-center rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wide border-blue-300 bg-blue-50 text-blue-700">
                    OCR Mode Used: Python OCR
                </span>
            </div>
            <div className="relative">
                <label
                    htmlFor="run-upload"
                    className={`
            flex items-center justify-center w-full p-4 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300
            ${isUploading
                            ? 'border-blue-300 bg-blue-50 text-blue-600'
                            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50 text-gray-500 hover:text-blue-500'}
          `}
                >
                    {isUploading ? (
                        <div className="flex items-center gap-3">
                            <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="font-semibold">Analyzing Run Data... (Gemini 3.0 Flash)</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span className="font-medium text-lg">Upload Run Summary</span>
                            </div>
                            <p className="text-xs text-gray-400">Supports PNG, JPG (Auto-Analysis)</p>
                        </div>
                    )}

                    <input
                        id="run-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={isUploading}
                    />
                </label>
            </div>
        </div>
    );
}
