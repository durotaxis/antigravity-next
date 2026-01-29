import { RunData, ApiResponse, VisionAnalysisData, ImageAsset } from '@/types';

// Access the API_BASE_URL from environment variables or default to localhost:3000
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(response.status, errorText || 'API Request Failed');
    }
    return response.json();
}

export const api = {
    /**
     * Fetch stride and heart rate data for a specific date
     */
    getStrideData: async (date: string): Promise<RunData[]> => {
        try {
            const res = await fetch(`${API_BASE}/api/stride?date=${date}`);
            return await handleResponse<RunData[]>(res);
        } catch (error) {
            console.error('Failed to fetch stride data:', error);
            throw error;
        }
    },

    /**
     * Trigger Vision Analysis for a specific image
     */
    analyzeVision: async (filename: string): Promise<ApiResponse<VisionAnalysisData>> => {
        try {
            const res = await fetch(`${API_BASE}/api/analyze-vision`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filename }),
            });
            return await handleResponse<ApiResponse<VisionAnalysisData>>(res);
        } catch (error) {
            console.error('Vision analysis failed:', error);
            throw error;
        }
    },

    /**
     * Fetch list of images for a specific date
     */
    getImages: async (date: string): Promise<ImageAsset[]> => {
        try {
            const res = await fetch(`${API_BASE}/api/runs/${date}/images`);
            // The backend returns an array of image objects. 
            // We might need to map them to conform exactly if the backend structure differs slightly,
            // but based on script.js it returns { stored_filename, total_time, ... }
            return await handleResponse<ImageAsset[]>(res);
        } catch (error) {
            console.error('Failed to fetch images:', error);
            return [];
        }
    },

    /**
     * Fetch inbox files from Phone Link
     */
    getInboxFiles: async (): Promise<string[]> => {
        try {
            const res = await fetch(`${API_BASE}/api/inbox/files`);
            return await handleResponse<string[]>(res);
        } catch (error) {
            console.error('Failed to fetch inbox files:', error);
            throw error;
        }
    },

    /**
     * Import selected images for a date
     */
    importImages: async (date: string, filenames: string[]): Promise<void> => {
        try {
            await fetch(`${API_BASE}/api/runs/${date}/import-selected`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames })
            });
        } catch (error) {
            console.error('Import failed:', error);
            throw error;
        }
    },

    /**
     * Unlink an image from a run
     */
    unlinkImage: async (date: string, assetId: number): Promise<void> => {
        try {
            await fetch(`${API_BASE}/api/runs/${date}/images/${assetId}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.error('Unlink failed:', error);
            throw error;
        }
    }
};
