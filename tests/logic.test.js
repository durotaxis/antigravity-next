const { calculateStride } = require('../vision_service');
const { extractDateFromFilename } = require('../image_service');

describe('Unit Tests: Logic', () => {

    describe('Stride Calculation', () => {
        test('should calculate stride correctly for normal values', () => {
            // 10km, 10000 steps -> 100cm stride
            expect(calculateStride(10, 10000)).toBe(100.00);

            // 5km, 6000 steps -> 83.33cm stride
            expect(calculateStride(5, 6000)).toBe(83.33);
        });

        test('should return null if step count is zero', () => {
            expect(calculateStride(10, 0)).toBeNull();
        });

        test('should return null if distance is missing', () => {
            expect(calculateStride(null, 1000)).toBeNull();
        });

        test('should return null if inputs are invalid', () => {
            expect(calculateStride(undefined, undefined)).toBeNull();
        });
    });

    describe('Date Parsing', () => {
        test('should extract date from standard screenshot filename', () => {
            const filename = 'Screenshot_20260124-190513.png';
            expect(extractDateFromFilename(filename)).toBe('2026-01-24');
        });

        test('should extract date even with different prefix', () => {
            const filename = 'IMG_20251231_123456.jpg';
            expect(extractDateFromFilename(filename)).toBe('2025-12-31');
        });

        test('should return null if no date pattern found', () => {
            const filename = 'running_shoe.png';
            expect(extractDateFromFilename(filename)).toBeNull();
        });
    });
});
