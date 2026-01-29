const request = require('supertest');
const fs = require('fs');
const path = require('path');
// Mock MUST be defined before requiring the app (which requires services)
jest.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: jest.fn().mockReturnValue({
                generateContent: jest.fn().mockResolvedValue({
                    response: {
                        text: () => JSON.stringify({
                            date: "2026-01-27",
                            step_count: 1234,
                            total_distance_km: 1.2,
                            total_time: "00:10:00",
                            avg_heart_rate: 120,
                            calories_kcal: 100,
                            avg_stride_cm: 97.2
                        })
                    }
                })
            })
        }))
    };
});

const app = require('../index');
const db = require('../db');

const TEST_FILE = 'test_image.png';
const STORE_DIR = path.join(__dirname, '../public/assets/store');

describe('Integration Tests: API', () => {

    beforeAll(() => {
        // Create a dummy image file for testing
        if (!fs.existsSync(STORE_DIR)) {
            fs.mkdirSync(STORE_DIR, { recursive: true });
        }
        fs.writeFileSync(path.join(STORE_DIR, TEST_FILE), 'dummy content');
    });

    afterAll((done) => {
        // Clean up dummy file
        try {
            fs.unlinkSync(path.join(STORE_DIR, TEST_FILE));
        } catch (e) { }

        // Close DB connection (optional, depending on how db.js exposes it)
        // db class in sqlite3 doesn't have a direct async close that we easily wait on without callback
        db.close((err) => {
            done();
        });
    });

    describe('POST /api/analyze-vision', () => {
        test('should analyze image and return metrics (Mocked Gemini)', async () => {
            const res = await request(app)
                .post('/api/analyze-vision')
                .send({ filename: TEST_FILE });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            const data = res.body.data;
            expect(data).toHaveProperty('step_count', 1234);
            expect(data).toHaveProperty('avg_stride_cm');
            expect(data.avg_heart_rate).toBe(120);
        });

        test('should return 400 if filename is missing', async () => {
            const res = await request(app)
                .post('/api/analyze-vision')
                .send({});

            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        test('should handle file not found error gracefully', async () => {
            const res = await request(app)
                .post('/api/analyze-vision')
                .send({ filename: 'non_existent.png' });

            // Depends on how error is handled. Code logs error and throws 500
            expect(res.statusCode).toBe(500);
        });
    });
});
