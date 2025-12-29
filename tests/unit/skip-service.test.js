// Hoisted mocks - must be before requiring the repositories
jest.mock('axios');
jest.mock('../../src/repositories/skip.repository', () => ({
    ensureInit: jest.fn().mockResolvedValue(),
    findByFullId: jest.fn().mockResolvedValue(null),
    findBySeriesId: jest.fn().mockResolvedValue([]),
    getRecentSegments: jest.fn().mockResolvedValue([]),
    getGlobalStats: jest.fn().mockResolvedValue([{ total: 0 }]),
    addSegment: jest.fn().mockResolvedValue({ start: 10, end: 20, label: 'Intro' }),
    updateSegments: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOne: jest.fn().mockResolvedValue(null)
}));
jest.mock('../../src/repositories/cache.repository', () => ({
    ensureInit: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    getCacheSync: jest.fn().mockReturnValue(null)
}));
jest.mock('../../src/services/catalog', () => ({
    registerShow: jest.fn().mockResolvedValue(),
    bakeShowSegments: jest.fn().mockResolvedValue(),
    getShowByImdbId: jest.fn().mockResolvedValue(null),
    fetchMetadata: jest.fn().mockResolvedValue(null)
}));

describe('Skip Service', () => {
    let skipService;
    let skipRepository;

    const loadService = async () => {
        jest.resetModules();
        skipRepository = require('../../src/repositories/skip.repository');
        return require('../../src/services/skip-service');
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getSkipSegment', () => {
        it('should return null if no segment found in DB', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue(null);

            const result = await skipService.getSkipSegment('tt12345:1:1');
            expect(result).toBeNull();
        });

        it('should return segment from MongoDB if available', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue({
                fullId: 'tt12345:1:1',
                segments: [{ start: 10, end: 20, label: 'Intro', verified: true }]
            });

            const result = await skipService.getSkipSegment('tt12345:1:1');
            expect(result).toEqual({ start: 10, end: 20, source: 'community' });
        });

        it('should use Aniskip fallback if not in DB', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue(null);

            // Mock axios globally for this test
            const axiosMock = require('axios');
            axiosMock.get.mockImplementation((url) => {
                if (url.includes('cinemeta')) {
                    return Promise.resolve({ data: { meta: { name: 'Naruto' } } });
                }
                if (url.includes('jikan')) {
                    return Promise.resolve({ data: { data: [{ mal_id: 20 }] } });
                }
                if (url.includes('api.aniskip.com')) {
                    return Promise.resolve({
                        data: {
                            found: true,
                            results: [{ skipType: 'op', interval: { startTime: 100, endTime: 200 } }]
                        }
                    });
                }
                return Promise.reject(new Error('not found'));
            });

            const result = await skipService.getSkipSegment('tt99999:1:1');
            expect(result).toEqual({ start: 100, end: 200, label: 'Intro', source: 'aniskip' });
        });

        it('should use IntroDB fallback if available', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue(null);

            const axiosMock = require('axios');
            axiosMock.get.mockImplementation((url) => {
                if (url.includes('api.introdb.app/intro')) {
                    return Promise.resolve({
                        data: {
                            intro: { start: 5, end: 85 }
                        }
                    });
                }
                return Promise.reject(new Error('not found'));
            });

            const result = await skipService.getSkipSegment('tt77777:1:1');
            expect(result).toEqual({ start: 5, end: 85, label: 'Intro', source: 'introdb' });
        });

        it('should correctly map Kitsu ID to MAL and fetch skips', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue(null);

            const axiosMock = require('axios');
            axiosMock.get.mockImplementation((url) => {
                if (url.includes('kitsu.io/api/edge/anime/123/mappings')) {
                    return Promise.resolve({
                        data: {
                            data: [{ attributes: { externalId: '456' } }]
                        }
                    });
                }
                if (url.includes('api.aniskip.com/v2/skip-times/456/1')) {
                    return Promise.resolve({
                        data: {
                            found: true,
                            results: [{ skipType: 'op', interval: { startTime: 10, endTime: 90 } }]
                        }
                    });
                }
                return Promise.reject(new Error('not found'));
            });

            const result = await skipService.getSkipSegment('kitsu:123:1');
            expect(result).toEqual({ start: 10, end: 90, label: 'Intro', source: 'aniskip' });
        });
    });

    describe('getSegments', () => {
        it('should return empty array for non-existent video', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue(null);

            const result = await skipService.getSegments('tt00000:1:1');
            expect(result).toEqual([]);
        });

        it('should return segments for existing video', async () => {
            skipService = await loadService();
            skipRepository.findByFullId.mockResolvedValue({
                fullId: 'tt12345:1:1',
                segments: [
                    { start: 10, end: 20, label: 'Intro' },
                    { start: 100, end: 110, label: 'Outro' }
                ]
            });

            const result = await skipService.getSegments('tt12345:1:1');
            expect(result.length).toBe(2);
            expect(result[0].start).toBe(10);
            expect(result[1].start).toBe(100);
        });
    });

    describe('getRecentSegments', () => {
        it('should return recent segments through repository', async () => {
            skipService = await loadService();
            skipRepository.getRecentSegments.mockResolvedValue([
                {
                    videoId: 'tt111:1:1',
                    label: 'Intro',
                    createdAt: '2025-01-02T10:00:00Z',
                    source: 'community'
                }
            ]);

            const result = await skipService.getRecentSegments(10);
            expect(result[0].videoId).toBe('tt111:1:1');
        });
    });

    describe('addSkipSegment', () => {
        it('should add new segment to database', async () => {
            skipService = await loadService();
            skipRepository.findOne.mockResolvedValue(null);
            skipRepository.addSegment.mockResolvedValue({ start: 10, end: 20, label: 'Intro' });

            const result = await skipService.addSkipSegment('tt12345:1:1', 10, 20, 'Intro', 'user123');

            expect(result).not.toBeNull();
            expect(result.start).toBe(10);
            expect(result.end).toBe(20);
        });

        it('should reject invalid times', async () => {
            skipService = await loadService();
            await expect(skipService.addSkipSegment('tt12345:1:1', -5, 20)).rejects.toThrow();
        });
    });

    describe('getSegmentCount', () => {
        it('should return segment count from repository', async () => {
            skipService = await loadService();
            skipRepository.getGlobalStats.mockResolvedValue([{ total: 1500 }]);

            const count = await skipService.getSegmentCount();
            expect(count).toBe(1500);
        });
    });
});
