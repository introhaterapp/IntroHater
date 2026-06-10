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
        const imdbId = 'tt1234567';
        const season = 1;
        const episode = 1;
        const fullId = `${imdbId}:${season}:${episode}`;

        axios.get.mockResolvedValueOnce({
            data: { start_sec: 10, end_sec: 100 }
        });

        const result = await skipService.getSkipSegment(fullId);
        expect(result).not.toBeNull();
        expect(result.start).toBe(10);
        expect(result.end).toBe(100);
    });

    it('should fetch intro from TheIntroDB segments API', async () => {
        const imdbId = 'tt1234567';
        const season = 1;
        const episode = 1;
        const fullId = `${imdbId}:${season}:${episode}`;

        axios.get
            .mockResolvedValueOnce({ data: {} })
            .mockResolvedValueOnce({
                data: {
                    intro: [{ start_ms: 5000, end_ms: 90000 }]
                }
            });

        const result = await skipService.getSkipSegment(fullId);
        expect(result).not.toBeNull();
        expect(result.start).toBe(5);
        expect(result.end).toBe(90);
        expect(result.source).toBe('theintrodb');
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
