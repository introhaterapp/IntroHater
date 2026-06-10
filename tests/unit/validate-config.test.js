const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

jest.mock('../../src/middleware/debridAuth', () => ({
    verifyDebridKey: jest.fn(),
    getProvider: jest.fn(() => ({ name: 'Real-Debrid' }))
}));

jest.mock('../../src/services/skip-service', () => ({}));
jest.mock('../../src/services/catalog', () => ({}));
jest.mock('../../src/services/scraper-health', () => ({
    getStatus: jest.fn(() => ({}))
}));
jest.mock('../../src/config/swagger-config', () => ({}));
jest.mock('../../src/utils/data-provider', () => ({
    searchWithProvider: jest.fn()
}));
jest.mock('../../src/routes/stats', () => require('express').Router());
jest.mock('../../src/routes/moderation', () => require('express').Router());
jest.mock('../../src/routes/submissions', () => require('express').Router());

const { verifyDebridKey } = require('../../src/middleware/debridAuth');
const apiRouter = require('../../src/routes/api');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

describe('POST /api/validate-config', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns invalid when debrid key and scraper URL are missing', async () => {
        const res = await request(app)
            .post('/api/validate-config')
            .send({});

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.checks.debrid.ok).toBe(false);
        expect(res.body.checks.scraper.ok).toBe(false);
    });

    it('returns valid when debrid key and scraper manifest both pass', async () => {
        verifyDebridKey.mockResolvedValue(true);
        axios.get.mockResolvedValue({
            data: { id: 'org.aiostreams', name: 'AIOStreams' }
        });

        const res = await request(app)
            .post('/api/validate-config')
            .send({
                provider: 'realdebrid',
                debridKey: 'test-key',
                scraperUrl: 'https://aiostreams.example.com/manifest.json'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.checks.debrid.ok).toBe(true);
        expect(res.body.checks.scraper.ok).toBe(true);
        expect(verifyDebridKey).toHaveBeenCalledWith('realdebrid', 'test-key');
        expect(axios.get).toHaveBeenCalledWith(
            'https://aiostreams.example.com/manifest.json',
            expect.objectContaining({ timeout: 8000 })
        );
    });

    it('returns invalid when debrid key fails verification', async () => {
        verifyDebridKey.mockResolvedValue(false);
        axios.get.mockResolvedValue({
            data: { id: 'org.aiostreams', name: 'AIOStreams' }
        });

        const res = await request(app)
            .post('/api/validate-config')
            .send({
                provider: 'realdebrid',
                debridKey: 'bad-key',
                scraperUrl: 'https://aiostreams.example.com'
            });

        expect(res.body.valid).toBe(false);
        expect(res.body.checks.debrid.ok).toBe(false);
        expect(res.body.checks.scraper.ok).toBe(true);
    });

    it('returns invalid when scraper URL is unreachable', async () => {
        verifyDebridKey.mockResolvedValue(true);
        axios.get.mockRejectedValue(new Error('Network error'));

        const res = await request(app)
            .post('/api/validate-config')
            .send({
                provider: 'realdebrid',
                debridKey: 'test-key',
                scraperUrl: 'https://aiostreams.example.com/manifest.json'
            });

        expect(res.body.valid).toBe(false);
        expect(res.body.checks.debrid.ok).toBe(true);
        expect(res.body.checks.scraper.ok).toBe(false);
    });
});
