const request = require('supertest');
const app = require('../../server');
const axios = require('axios');



jest.mock('../../src/services/skip-service.js', () => ({
    getSkipSegment: jest.fn().mockResolvedValue(null),
    getAllSegments: jest.fn().mockResolvedValue({}),
    getSegmentCount: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../src/services/user-service.js', () => ({
    getStats: jest.fn().mockResolvedValue({}),
    getLeaderboard: jest.fn().mockResolvedValue([])
}));

jest.mock('../../src/services/catalog.js', () => ({
    repairCatalog: jest.fn(),
    getCatalogStats: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/services/indexer.js', () => ({
    start: jest.fn()
}));

jest.mock('axios');

describe('Watch History Fix Integration', () => {
    it('should include rdKey in the generated proxy URL', async () => {
        
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

        
        expect(proxyUrl).toContain(`rdKey=${RD_KEY}`);
    });
});
