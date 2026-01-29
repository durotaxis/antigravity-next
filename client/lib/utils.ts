/**
 * Calculate Simple Moving Average (SMA)
 * @param data Array of numbers
 * @param windowSize Window size for the moving average
 * @returns Array of SMA values
 */
export function calculateSMA(data: number[], windowSize: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < windowSize - 1) {
            // Not enough data for full window, push raw data
            // (Matching original script.js logic which pushes data[i])
            sma.push(data[i]);
        } else {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                sum += data[i - j];
            }
            sma.push(sum / windowSize);
        }
    }
    return sma;
}

/**
* Format date to YYYY-MM-DD
*/
export function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
* Format keys for chart display or logging
*/
export function formatTime(seconds: number): string {
    // if needed
    return seconds.toString();
}
