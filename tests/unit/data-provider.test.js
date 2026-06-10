const axios = require('axios');

jest.mock('axios');

const dataProvider = require('../../src/utils/data-provider');

describe('data-provider', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.DATA_PROVIDER;
        delete process.env.OMDB_API_KEY;
        delete process.env.TMDB_API_KEY;
    });

    describe('getDataProvider', () => {
        it('defaults to OMDB', () => {
            expect(dataProvider.getDataProvider()).toBe('OMDB');
        });

        it('returns TMDB when configured', () => {
            process.env.DATA_PROVIDER = 'tmdb';
            expect(dataProvider.getDataProvider()).toBe('TMDB');
        });

        it('falls back to OMDB for invalid values', () => {
            process.env.DATA_PROVIDER = 'invalid';
            expect(dataProvider.getDataProvider()).toBe('OMDB');
        });
    });

    describe('mapTmdbFindResult', () => {
        it('maps movie results', () => {
            const result = dataProvider.mapTmdbFindResult({
                movie_results: [{
                    title: 'Inception',
                    release_date: '2010-07-16',
                    poster_path: '/poster.jpg'
                }]
            });

            expect(result).toEqual({
                Title: 'Inception',
                Year: '2010',
                Poster: 'https://image.tmdb.org/t/p/w500/poster.jpg'
            });
        });

        it('maps tv results', () => {
            const result = dataProvider.mapTmdbFindResult({
                movie_results: [],
                tv_results: [{
                    name: 'Breaking Bad',
                    first_air_date: '2008-01-20',
                    poster_path: '/tv.jpg'
                }]
            });

            expect(result).toEqual({
                Title: 'Breaking Bad',
                Year: '2008',
                Poster: 'https://image.tmdb.org/t/p/w500/tv.jpg'
            });
        });
    });

    describe('searchWithProvider', () => {
        it('returns OMDB search results', async () => {
            process.env.OMDB_API_KEY = 'test-key';

            axios.get.mockResolvedValueOnce({
                data: {
                    Search: [{
                        Title: 'Test Movie',
                        Year: '2020',
                        imdbID: 'tt1234567',
                        Type: 'movie',
                        Poster: 'N/A'
                    }]
                }
            });

            const result = await dataProvider.searchWithProvider('test');

            expect(result).toEqual({
                Search: [{
                    Title: 'Test Movie',
                    Year: '2020',
                    imdbID: 'tt1234567',
                    Type: 'movie',
                    Poster: 'N/A'
                }]
            });
        });

        it('maps TMDB multi search to OMDB shape with imdb IDs', async () => {
            process.env.DATA_PROVIDER = 'TMDB';
            process.env.TMDB_API_KEY = 'test-key';

            axios.get
                .mockResolvedValueOnce({
                    data: {
                        results: [
                            {
                                id: 42,
                                media_type: 'tv',
                                name: 'Breaking Bad',
                                first_air_date: '2008-01-20',
                                poster_path: '/tv.jpg'
                            },
                            {
                                id: 99,
                                media_type: 'person',
                                name: 'Ignored Person'
                            }
                        ]
                    }
                })
                .mockResolvedValueOnce({
                    data: { imdb_id: 'tt0903747' }
                });

            const result = await dataProvider.searchWithProvider('breaking bad');

            expect(result.Search).toEqual([{
                Title: 'Breaking Bad',
                Year: '2008',
                Type: 'series',
                Poster: 'https://image.tmdb.org/t/p/w500/tv.jpg',
                imdbID: 'tt0903747'
            }]);
        });

        it('returns empty search when provider key is missing', async () => {
            process.env.DATA_PROVIDER = 'TMDB';
            const result = await dataProvider.searchWithProvider('test');
            expect(result).toEqual({ Search: [] });
        });
    });

    describe('fetchMetadataFromProvider', () => {
        it('fetches TV metadata from TMDB find endpoint', async () => {
            process.env.DATA_PROVIDER = 'TMDB';
            process.env.TMDB_API_KEY = 'test-key';

            axios.get.mockResolvedValueOnce({
                data: {
                    movie_results: [],
                    tv_results: [{
                        name: 'Breaking Bad',
                        first_air_date: '2008-01-20',
                        poster_path: '/tv.jpg'
                    }]
                }
            });

            const result = await dataProvider.fetchMetadataFromProvider('tt0903747');

            expect(result).toEqual({
                Title: 'Breaking Bad',
                Year: '2008',
                Poster: 'https://image.tmdb.org/t/p/w500/tv.jpg'
            });
        });
    });
});
