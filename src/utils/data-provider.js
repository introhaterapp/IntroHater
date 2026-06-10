const axios = require('axios');
const { OMDB, TMDB } = require('../config/constants');

const DATA_PROVIDERS = ['OMDB', 'TMDB'];

function getDataProvider() {
    const provider = (process.env.DATA_PROVIDER || 'OMDB').toUpperCase();
    return DATA_PROVIDERS.includes(provider) ? provider : 'OMDB';
}

function mapTmdbFindResult(findData) {
    const movie = findData?.movie_results?.[0];
    if (movie) {
        return {
            Title: movie.title,
            Year: movie.release_date ? movie.release_date.substring(0, 4) : '????',
            Poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null
        };
    }

    const tv = findData?.tv_results?.[0];
    if (tv) {
        return {
            Title: tv.name,
            Year: tv.first_air_date ? tv.first_air_date.substring(0, 4) : '????',
            Poster: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null
        };
    }

    return null;
}

function mapTmdbItemToOmdbSearch(item) {
    const isTv = item.media_type === 'tv';
    const title = isTv ? item.name : item.title;
    const yearSource = isTv ? item.first_air_date : item.release_date;

    return {
        Title: title || 'Unknown Title',
        Year: yearSource ? yearSource.substring(0, 4) : '????',
        Type: isTv ? 'series' : 'movie',
        Poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'N/A',
        imdbID: null
    };
}

async function fetchTmdbExternalId(tmdbId, mediaType) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return null;

    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const response = await axios.get(`${TMDB.BASE_URL}/${endpoint}/${tmdbId}/external_ids`, {
        params: { api_key: apiKey }
    });
    return response.data?.imdb_id || null;
}

async function fetchMetadataFromProvider(imdbId, provider = getDataProvider()) {
    const omdbKey = process.env.OMDB_API_KEY;
    const tmdbKey = process.env.TMDB_API_KEY;

    if (provider === 'OMDB' && omdbKey) {
        const response = await axios.get(`${OMDB.BASE_URL}/`, {
            params: { i: imdbId, apikey: omdbKey }
        });
        if (response.data && response.data.Response !== 'False') {
            return {
                Title: response.data.Title,
                Year: response.data.Year,
                Poster: response.data.Poster !== 'N/A' ? response.data.Poster : null
            };
        }
        return null;
    }

    if (provider === 'TMDB' && tmdbKey) {
        const response = await axios.get(`${TMDB.BASE_URL}/find/${imdbId}`, {
            params: {
                api_key: tmdbKey,
                language: 'en-US',
                external_source: 'imdb_id'
            }
        });
        return mapTmdbFindResult(response.data);
    }

    return null;
}

async function searchWithProvider(query, provider = getDataProvider()) {
    if (!query) return { Search: [] };

    const omdbKey = process.env.OMDB_API_KEY;
    const tmdbKey = process.env.TMDB_API_KEY;

    if (provider === 'OMDB' && omdbKey) {
        const response = await axios.get(`${OMDB.BASE_URL}/`, {
            params: { s: query, apikey: omdbKey }
        });
        return response.data?.Search ? { Search: response.data.Search } : { Search: [] };
    }

    if (provider === 'TMDB' && tmdbKey) {
        const response = await axios.get(`${TMDB.BASE_URL}/search/multi`, {
            params: {
                query,
                api_key: tmdbKey,
                include_adult: false,
                language: 'en-US'
            }
        });

        const candidates = (response.data?.results || [])
            .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
            .slice(0, 10);

        const searchItems = await Promise.all(
            candidates.map(async (item) => {
                const mapped = mapTmdbItemToOmdbSearch(item);
                const imdbId = await fetchTmdbExternalId(item.id, item.media_type);
                if (!imdbId) return null;
                mapped.imdbID = imdbId;
                return mapped;
            })
        );

        return { Search: searchItems.filter(Boolean) };
    }

    return { Search: [] };
}

module.exports = {
    DATA_PROVIDERS,
    getDataProvider,
    mapTmdbFindResult,
    mapTmdbItemToOmdbSearch,
    fetchMetadataFromProvider,
    searchWithProvider
};
