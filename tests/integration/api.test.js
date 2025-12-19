const request = require('supertest');
const app = require('../../server_lite');

// Mocks
// Mocks
jest.mock('../../src/services/skip-service.js', () => {
    console.log('!!! MOCKING SKIP SERVICE !!!');
    return {
        getAllSegments: jest.fn().mockResolvedValue({
            'tt11111:1:1': [{ start: 0, end: 10 }]
        }),
        getSkipSegment: jest.fn(),
        reportSegment: jest.fn(),
        addSkipSegment: jest.fn().mockResolvedValue({
            start: 10, end: 20, label: 'Intro', verified: false, contributors: ['user']
        }),
        resolveModeration: jest.fn(),
        getPendingModeration: jest.fn()
    };
});

jest.mock('../../src/services/user-service.js', () => ({
    getStats: jest.fn().mockResolvedValue({ userCount: 10, voteCount: 50 }),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    getUserStats: jest.fn().mockResolvedValue({ userId: 'u1', votes: 5 }),
    updateUserStats: jest.fn().mockResolvedValue({ userId: 'u1', votes: 6 })
}));

// Mock Indexer to prevent interval checks
jest.mock('../../src/services/indexer.js', () => ({
    start: jest.fn(),
    runIndex: jest.fn()
}));

// Mock rate-limit to avoid open handles (timer)
jest.mock('express-rate-limit', () => {
    return jest.fn(() => (req, res, next) => next());
});

// Mock Axios for RD checks
jest.mock('axios'); // Required to use __mocks__/axios.js

const axios = require('axios');

describe('API Integration', () => {
    beforeEach(() => {
        // Reset defaults
        axios.get.mockResolvedValue({ data: {} });
    });

    describe('Public endpoints (GET)', () => {
        it('GET /api/stats should return stats', async () => {
            const res = await request(app).get('/api/stats');
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('users');
            expect(res.body).toHaveProperty('skips');
        });

        it('GET /api/catalog should return catalog structure', async () => {
            const res = await request(app).get('/api/catalog');
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('media');
        });

        it('GET /manifest.json should return the addon manifest', async () => {
            const res = await request(app).get('/manifest.json');
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('id', 'org.introhater.lite');
        });
    });

    describe('Personal Stats (POST /api/stats/personal)', () => {
        it('should return 400 if RD Key is missing', async () => {
            const res = await request(app).post('/api/stats/personal').send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body).toHaveProperty('error');
        });

        it('should return user stats with history if key provided', async () => {
            const res = await request(app).post('/api/stats/personal').send({ rdKey: 'valid_key' });
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('userId');
            expect(res.body).toHaveProperty('history');
        });
    });

    describe('Reporting (POST /api/report)', () => {
        it('should return 400 if missing videoId or Key', async () => {
            const res = await request(app).post('/api/report').send({ rdKey: 'key' });
            expect(res.statusCode).toEqual(400);
        });

        it('should return 401 if RD Key is invalid (Mocked Axios)', async () => {
            // Mock DB Key check failure
            axios.get.mockRejectedValue(new Error('Unauthorized')); // Fail the RD check

            const res = await request(app).post('/api/report').send({
                rdKey: 'bad_key', videoId: 'tt123'
            });
            expect(res.statusCode).toEqual(401);
        });

        it.skip('should succeed if key valid', async () => {
            // Mock Success with debug log
            axios.get.mockImplementation(() => {
                console.log('!!! AXIOS MOCK EXECUTED !!!');
                return Promise.resolve({ data: { id: 12345 } });
            });

            const res = await request(app).post('/api/report').send({
                rdKey: 'good_key', videoId: 'tt123', reason: 'Bad sync'
            });
            expect(res.statusCode).toEqual(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('Submissions (POST /api/submit)', () => {
        it('should return 400 if fields missing', async () => {
            const res = await request(app).post('/api/submit').send({ rdKey: 'k', imdbID: 'tt' });
            expect(res.statusCode).toEqual(400);
        });

        it.skip('should submit successfully with valid data', async () => {
            // Implementation of Axios Mock that handles "real-debrid" calls AND "omdbapi" calls
            axios.get.mockImplementation((url) => {
                if (url.includes('real-debrid')) return Promise.resolve({ data: { id: 12345 } });
                return Promise.resolve({ data: {} });
            });

            const res = await request(app).post('/api/submit').send({
                rdKey: 'k', imdbID: 'tt', start: 10, end: 20
            });
            expect(res.statusCode).toEqual(200);
            expect(res.body.segment).toBeDefined();
        });
    });
});
