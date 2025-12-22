const request = require('supertest');
const app = require('../../server');
const axios = require('axios');

// Mocks
jest.mock('../../src/services/skip-service.js', () => ({
    getSkipSegment: jest.fn().mockResolvedValue(null),
    getAllSegments: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/services/user-service.js', () => ({}));
jest.mock('../../src/services/catalog.js', () => ({ repairCatalog: jest.fn() }));
jest.mock('../../src/services/indexer.js', () => ({}));

jest.mock('axios');

describe('Watch History Fix Integration', () => {
    it('should include rdKey in the generated proxy URL', async () => {
        // Mock Upstream Torrentio Response
        axios.get.mockResolvedValue({
            status: 200,
            data: {
                streams: [
                    {
                        name: 'Test Stream',
                        title: 'Test Title',
                        url: 'https://example.com/video.mp4'
                    }
                ]
            }
        });

        const RD_KEY = 'test_rd_key_123';
        const VIDEO_ID = 'tt1234567';

        const res = await request(app).get(`/${RD_KEY}/stream/movie/${VIDEO_ID}.json`);

        expect(res.statusCode).toEqual(200);
        expect(res.body.streams).toBeDefined();
        expect(res.body.streams.length).toBeGreaterThan(0);

        const proxyUrl = res.body.streams[0].url;
        console.log('Generated Proxy URL:', proxyUrl);

        // Verification: The URL MUST contain the rdKey for the history logging to work
        expect(proxyUrl).toContain(`rdKey=${RD_KEY}`);
    });
});
