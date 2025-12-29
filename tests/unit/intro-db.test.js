jest.mock('axios');


jest.mock('../../src/repositories/skip.repository', () => ({
    ensureInit: jest.fn().mockResolvedValue(),
    findOne: jest.fn().mockResolvedValue(null),
    addSegment: jest.fn().mockResolvedValue({}),
    findByFullId: jest.fn().mockResolvedValue(null),
    findBySeriesId: jest.fn().mockResolvedValue([]),
    updateSegments: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/repositories/cache.repository', () => ({
    ensureInit: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/services/catalog', () => ({
    registerShow: jest.fn().mockResolvedValue(),
    getShowByImdbId: jest.fn().mockResolvedValue(null)
}));

describe('IntroDB Integration', () => {
    let skipService;
    let axios;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        skipService = require('../../src/services/skip-service');
        axios = require('axios');
    });

    it('should fetch intro from IntroDB and return it', async () => {
        try {
            const imdbId = 'tt1234567';
            const season = 1;
            const episode = 1;
            const fullId = `${imdbId}:${season}:${episode}`;

            axios.get.mockResolvedValueOnce({
                data: {
                    intro: { start: 10.5, end: 100.2 },
                    outro: { start: 1200, end: 1300 }
                }
            });

            const result = await skipService.getSkipSegment(fullId);
            console.log('Result:', result);

            expect(result).not.toBeNull();
            expect(result.start).toBe(10.5);
        } catch (e) {
            console.error('Test error:', e);
            throw e;
        }
    });

    it('should handle IntroDB API errors gracefully', async () => {
        try {
            axios.get.mockRejectedValueOnce(new Error('API Down'));

            const result = await skipService.getSkipSegment('tt9999999:1:1');
            console.log('Error path result:', result);
            expect(result).toBeNull();
        } catch (e) {
            console.error('Test error (error path):', e);
            throw e;
        }
    });
});
