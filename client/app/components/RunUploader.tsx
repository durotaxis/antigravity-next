'use client';

import { useEffect, useState } from 'react';

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
    const [apiBase, setApiBase] = useState(() => (process.env.NEXT_PUBLIC_API_URL || '').trim());
    const [isUploading, setIsUploading] = useState(false);
    const [runDate, setRunDate] = useState(() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    });

    useEffect(() => {
        if (!apiBase) {
            setApiBase(getApiBase());
        }
    }, [apiBase]);

    const isTcxFile = (file: File) => /\.tcx$/i.test(String(file.name || '').trim());

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const tcxUpload = isTcxFile(file);
        if (!tcxUpload && !runDate) {
            alert('Please select a run date first.');
            e.target.value = '';
            return;
        }

        setIsUploading(true);
        const formData = new FormData();
        const endpoint = tcxUpload ? '/api/import-tcx' : '/api/analyze';
        if (tcxUpload) {
            formData.append('file', file);
            if (runDate) {
                formData.append('date', runDate);
            }
        } else {
            formData.append('image', file);
            formData.append('date', runDate);
            // New screen upload is defined to use Python OCR path.
            formData.append('ocr_mode', 'python');
        }

        try {
            const res = await fetch(`${apiBase || getApiBase()}${endpoint}`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                if (!tcxUpload && res.status === 422 && errData?.code === 'MISSING_RUN_DATE') {
                    alert('Run date could not be determined. Set the run date and try again.');
                    setIsUploading(false);
                    e.target.value = '';
                    return;
                }
                throw new Error(errData.error || `Upload failed: ${res.statusText}`);
            }

            const data = await res.json();
            if (!tcxUpload && data?.data?.duplicate_upload) {
                alert('This image appears to be already imported. Existing data was reused.');
                setIsUploading(false);
                e.target.value = '';
                window.location.reload();
                return;
            }

            if (!tcxUpload && data?.data?.ocr_failed) {
                alert('OCR failed. The image was imported, but analysis values could not be extracted.');
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

    return (
        <div className="mb-6">
            <div className="mb-3 flex items-center gap-3">
                <label htmlFor="run-date" className="text-sm font-medium text-gray-600">Run Date (Upload Target)</label>
                <input
                    id="run-date"
                    type="date"
                    value={runDate}
                    onChange={(e) => setRunDate(e.target.value)}
                    disabled={isUploading}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-white"
                />
                <span className="text-xs font-medium uppercase tracking-wide text-blue-600">
                    OCR mode: Python OCR
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
                            <span className="font-semibold">Importing Run Data...</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span className="font-medium text-lg">Upload Run Summary</span>
                            </div>
                            <p className="text-xs text-gray-400">Supports PNG, JPG, TCX</p>
                        </div>
                    )}

                    <input
                        id="run-upload"
                        type="file"
                        accept="image/*,.tcx"
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={isUploading}
                    />
                </label>
            </div>
        </div>
    );
}



