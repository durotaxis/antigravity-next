export interface RunData {
    time: string;
    steps: number;
    distance: number;
    stride: number;
    heartRate: number | null;
}

export interface VisionAnalysisData {
    date?: string;
    step_count?: number;
    total_distance_km?: number;
    total_time?: string;
    avg_heart_rate?: number;
    calories_kcal?: number;
    avg_stride_cm?: number;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface ImageAsset {
    filename: string;
    url: string;
    analysis?: VisionAnalysisData | null;
}
