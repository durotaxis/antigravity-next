'use client';

import { useState } from 'react';

export default function RunUploader() {
    const [isUploading, setIsUploading] = useState(false);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append('image', file);

        try {
            const res = await fetch('http://192.168.3.153:3000/api/analyze', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Upload failed: ${res.statusText}`);
            }

            const data = await res.json();
            console.log('Analysis success:', data);

            if (data?.data?.ocr_failed) {
                alert('OCRに失敗しましたが、画像の取り込みは完了しました。回復後に再度お試し下さい。');
                setIsUploading(false);
                e.target.value = '';
                return;
            }

            // Reload to show new data
            window.location.reload();

        } catch (err: any) {
            console.error('Error uploading:', err);
            alert(`Analysis failed: ${err.message}`);
            setIsUploading(false);
            // Clear the input
            e.target.value = '';
        }
    };

    return (
        <div className="mb-6">
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
