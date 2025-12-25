/**
 * Skip Service Unit Tests
 * Tests segment retrieval, external API fallback, and caching with mocked MongoDB.
 */

const axios = require('axios');
const mongoService = require('../../src/services/mongodb');

// Hoisted mocks
jest.mock('axios');
jest.mock('../../src/services/mongodb', () => ({
    getCollection: jest.fn(),
    close: jest.fn()
}));
jest.mock('../../src/services/catalog', () => ({
    registerShow: jest.fn().mockResolvedValue(),
    bakeShowSegments: jest.fn().mockResolvedValue(),
    getShowByImdbId: jest.fn().mockResolvedValue(null)
}));

describe('Skip Service', () => {
    let skipService;
    let mockSkipsCollection;
    let mockCacheCollection;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock collections
        mockSkipsCollection = {
            createIndex: jest.fn().mockResolvedValue(true),
            findOne: jest.fn(),
            find: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            project: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            countDocuments: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([{ total: 0 }])
            })
        };

        mockCacheCollection = {
            createIndex: jest.fn().mockResolvedValue(true),
            findOne: jest.fn().mockResolvedValue(null),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
        };

        mongoService.getCollection.mockImplementation((name) => {
            if (name === 'skips') return Promise.resolve(mockSkipsCollection);
            if (name === 'cache') return Promise.resolve(mockCacheCollection);
            return Promise.resolve(null);
        });
    });

    afterAll(async () => {
        await mongoService.close();
    });

    const loadService = async () => {
        jest.resetModules();
        return require('../../src/services/skip-service');
    };

    describe('getSkipSegment', () => {
        it('should return null if no segment found in DB', async () => {
            mockSkipsCollection.findOne.mockResolvedValue(null);

            skipService = await loadService();
            const result = await skipService.getSkipSegment('tt12345:1:1');

            expect(result).toBeNull();
        });

        it('should return segment from MongoDB if available', async () => {
            mockSkipsCollection.findOne.mockResolvedValue({
                fullId: 'tt12345:1:1',
                segments: [{ start: 10, end: 20, label: 'Intro', verified: true }]
            });

            skipService = await loadService();
            const result = await skipService.getSkipSegment('tt12345:1:1');

            expect(result).toEqual({ start: 10, end: 20, source: 'community' });
        });

        it('should use Aniskip fallback if not in DB', async () => {
            mockSkipsCollection.findOne.mockResolvedValue(null);

            axios.get.mockImplementation((url) => {
                if (url.includes('cinemeta')) {
                    return Promise.resolve({ data: { meta: { name: 'Naruto' } } });
                }
                if (url.includes('jikan')) {
                    return Promise.resolve({ data: { data: [{ mal_id: 20 }] } });
                }
                if (url.includes('aniskip')) {
                    return Promise.resolve({
                        data: {
                            found: true,
                            results: [{ skipType: 'op', interval: { startTime: 100, endTime: 200 } }]
                        }
                    });
                }
                return Promise.reject(new Error('not found'));
            });

            skipService = await loadService();
            const result = await skipService.getSkipSegment('tt99999:1:1');

            expect(result).toEqual({ start: 100, end: 200, label: 'Intro', source: 'aniskip' });
        });
    });

    describe('getSegments', () => {
        it('should return empty array for non-existent video', async () => {
            mockSkipsCollection.findOne.mockResolvedValue(null);

            skipService = await loadService();
            const result = await skipService.getSegments('tt00000:1:1');

            expect(result).toEqual([]);
        });

        it('should return segments for existing video', async () => {
            mockSkipsCollection.findOne.mockResolvedValue({
                fullId: 'tt12345:1:1',
                segments: [
                    { start: 10, end: 20, label: 'Intro' },
                    { start: 100, end: 110, label: 'Outro' }
                ]
            });

            skipService = await loadService();
            const result = await skipService.getSegments('tt12345:1:1');

            expect(result.length).toBe(2);
            expect(result[0].start).toBe(10);
            expect(result[1].start).toBe(100);
        });
    });

    describe('getRecentSegments', () => {
        it('should return recent segments sorted by createdAt', async () => {
            mockSkipsCollection.toArray.mockResolvedValue([
                {
                    fullId: 'tt111:1:1',
                    segments: [{ label: 'Intro', createdAt: '2025-01-01T10:00:00Z' }]
                },
                {
                    fullId: 'tt222:1:1',
                    segments: [{ label: 'Intro', createdAt: '2025-01-02T10:00:00Z' }]
                }
            ]);

            skipService = await loadService();
            const result = await skipService.getRecentSegments(10);

            expect(Array.isArray(result)).toBe(true);
            // Should be sorted by createdAt desc
            if (result.length >= 2) {
                expect(new Date(result[0].createdAt) >= new Date(result[1].createdAt)).toBe(true);
            }
        });
    });

    describe('addSkipSegment', () => {
        it('should add new segment to database', async () => {
            mockSkipsCollection.findOne.mockResolvedValue(null);
            mockSkipsCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

            skipService = await loadService();
            const result = await skipService.addSkipSegment('tt12345:1:1', 10, 20, 'Intro', 'user123');

            expect(result).not.toBeNull();
            expect(result.start).toBe(10);
            expect(result.end).toBe(20);
        });

        it('should reject invalid times', async () => {
            skipService = await loadService();

            await expect(skipService.addSkipSegment('tt12345:1:1', -5, 20)).rejects.toThrow();
            await expect(skipService.addSkipSegment('tt12345:1:1', 30, 20)).rejects.toThrow();
        });
    });

    describe('getSegmentCount', () => {
        it('should return segment count from aggregation', async () => {
            mockSkipsCollection.aggregate.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([{ total: 1500 }])
            });

            skipService = await loadService();
            const count = await skipService.getSegmentCount();

            expect(count).toBe(1500);
        });
    });
});
