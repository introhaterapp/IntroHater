

const axios = require('axios');


const mockCatalogRepository = {
    ensureInit: jest.fn().mockResolvedValue(),
    findByImdbId: jest.fn(),
    upsertCatalogEntry: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    getCatalogData: jest.fn(),
    getCatalogStats: jest.fn()
};

jest.mock('../../src/repositories/catalog.repository', () => mockCatalogRepository);
jest.mock('axios');

describe('Catalog Service', () => {
    let catalogService;

    beforeEach(() => {
        jest.clearAllMocks();
        
        catalogService = require('../../src/services/catalog');
    });

    describe('fetchMetadata', () => {
        it('should fetch metadata from OMDB', async () => {
            process.env.OMDB_API_KEY = 'test-key';
            axios.get.mockResolvedValueOnce({
                data: {
                    Response: 'True',
                    Title: 'Breaking Bad',
                    Year: '2008',
                    Poster: 'https://example.com/poster.jpg'
                }
            });

            const result = await catalogService.fetchMetadata('tt0903747');

            expect(result).toEqual({
                Title: 'Breaking Bad',
                Year: '2008',
                Poster: 'https://example.com/poster.jpg'
            });
            expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('omdbapi.com'));
        });

        it('should return fallback data if all lookups fail', async () => {
            delete process.env.OMDB_API_KEY;
            axios.get.mockRejectedValue(new Error('Network error'));

            const result = await catalogService.fetchMetadata('tt0000000');

            expect(result.Title).toBe('tt0000000');
            expect(result.Year).toBe('????');
            expect(result.Poster).toBeNull();
        });
    });

    describe('registerShow', () => {
        it('should reject invalid IMDB IDs', async () => {
            await catalogService.registerShow('invalid-id:1:1');

            expect(mockCatalogRepository.upsertCatalogEntry).not.toHaveBeenCalled();
        });

        it('should register a new show with metadata', async () => {
            mockCatalogRepository.findByImdbId.mockResolvedValue(null);
            process.env.OMDB_API_KEY = 'test-key';
            axios.get.mockResolvedValueOnce({
                data: {
                    Response: 'True',
                    Title: 'Test Show',
                    Year: '2020',
                    Poster: null
                }
            });

            await catalogService.registerShow('tt1234567:1:1', 1);

            expect(mockCatalogRepository.upsertCatalogEntry).toHaveBeenCalledWith(
                'tt1234567',
                expect.objectContaining({
                    imdbId: 'tt1234567',
                    title: 'Test Show',
                    year: '2020'
                })
            );
        });
    });

    describe('getCatalogData', () => {
        it('should return paginated catalog data', async () => {
            mockCatalogRepository.getCatalogData.mockResolvedValue({
                items: [
                    { imdbId: 'tt111', title: 'Show A', year: '2020', totalSegments: 5 },
                    { imdbId: 'tt222', title: 'Show B', year: '2021', totalSegments: 3 }
                ],
                total: 50,
                filteredTotal: 50
            });

            const result = await catalogService.getCatalogData(1, 10, '', { title: 1 });

            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(10);
            expect(Object.keys(result.media).length).toBe(2);
            expect(result.media['tt111'].title).toBe('Show A');
        });

        it('should handle empty catalog', async () => {
            mockCatalogRepository.getCatalogData.mockResolvedValue({
                items: [],
                total: 0,
                filteredTotal: 0
            });

            const result = await catalogService.getCatalogData();

            expect(Object.keys(result.media).length).toBe(0);
            expect(result.total).toBe(0);
        });
    });

    describe('getCatalogStats', () => {
        it('should return aggregated catalog stats', async () => {
            mockCatalogRepository.getCatalogStats.mockResolvedValue({
                showCount: 100,
                episodeCount: 5000
            });

            const result = await catalogService.getCatalogStats();

            expect(result.showCount).toBe(100);
            expect(result.episodeCount).toBe(5000);
        });
    });

    describe('bakeShowSegments', () => {
        it('should bake segments into existing catalog entry', async () => {
            mockCatalogRepository.findByImdbId.mockResolvedValue({
                imdbId: 'tt1234567',
                title: 'Test Show',
                episodes: {},
                totalSegments: 0
            });

            await catalogService.bakeShowSegments('tt1234567', {
                '1:1': [{ start: 10, end: 100 }],
                '1:2': [{ start: 15, end: 105 }]
            });

            expect(mockCatalogRepository.upsertCatalogEntry).toHaveBeenCalledWith(
                'tt1234567',
                expect.objectContaining({
                    totalSegments: 2
                })
            );
        });
    });

    describe('getShowByImdbId', () => {
        it('should return show data by IMDB ID', async () => {
            const mockShow = {
                imdbId: 'tt1234567',
                title: 'Test Show',
                year: '2020',
                episodes: { '1:1': { segments: [{ start: 10, end: 100 }] } }
            };
            mockCatalogRepository.findByImdbId.mockResolvedValue(mockShow);

            const result = await catalogService.getShowByImdbId('tt1234567');

            expect(result).toEqual(mockShow);
        });

        it('should return null for non-existent show', async () => {
            mockCatalogRepository.findByImdbId.mockResolvedValue(null);

            const result = await catalogService.getShowByImdbId('tt0000000');

            expect(result).toBeNull();
        });
    });
});
