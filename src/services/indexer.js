const catalogService = require('./catalog');
const axios = require('axios');

class IndexerService {
    constructor() {
        this.isRunning = false;
        this.interval = 12 * 60 * 60 * 1000; // 12 Hours
    }

    start() {
        // Run immediately on start
        this.runIndex();

        // Schedule periodic runs
        setInterval(() => this.runIndex(), this.interval);
    }

    async runIndex() {
        if (this.isRunning) {
            console.log('[Indexer] Already running, skipping cycle.');
            return;
        }

        this.isRunning = true;
        console.log('[Indexer] Starting catalog indexing cycle (Source: Anime-Skip)...');

        try {
            await this.indexAnimeSkipCatalog();
        } catch (e) {
            console.error(`[Indexer] Cycle failed: ${e.message}`);
        } finally {
            this.isRunning = false;
            console.log('[Indexer] Indexing cycle complete.');
        }
    }

    async indexAnimeSkipCatalog() {
        const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';
        const BATCH_SIZE = 50;
        const MAX_PAGES = 50; // Index top 2500 shows

        let offset = 0;
        let running = true;
        let page = 0;

        while (running && page < MAX_PAGES) {
            try {
                // Query Anime-Skip to find shows.
                const query = `
                    query ($search: String!, $offset: Int, $limit: Int) {
                        searchShows(search: $search, offset: $offset, limit: $limit) {
                            id
                            name
                            externalLinks {
                                service
                                url
                            }
                        }
                    }
                `;

                const res = await axios.post('https://api.anime-skip.com/graphql', {
                    query,
                    variables: { search: " ", offset, limit: BATCH_SIZE }
                }, { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } });

                const shows = res.data?.data?.searchShows || [];

                if (shows.length === 0) {
                    console.log('[Indexer] No more shows found (empty result).');
                    running = false;
                    break;
                }

                console.log(`[Indexer] Processing batch ${page + 1} (${shows.length} shows)...`);

                for (const show of shows) {
                    let imdbId = null;
                    // Try to find IMDB ID in external Links
                    if (show.externalLinks) {
                        const imdbLink = show.externalLinks.find(e => e.service === 'IMDB' || (e.url && e.url.includes('imdb.com/title/')));
                        if (imdbLink && imdbLink.url) {
                            // Extract tt123456
                            const match = imdbLink.url.match(/(tt\d+)/);
                            if (match) imdbId = match[1];
                        }
                    }

                    // Fallback: Search Cinemeta by Name
                    if (!imdbId && show.name) {
                        try {
                            const searchUrl = `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(show.name)}.json`;
                            const searchRes = await axios.get(searchUrl);
                            if (searchRes.data?.metas?.length > 0) {
                                imdbId = searchRes.data.metas[0].id;
                                // console.log(`[Indexer] Mapped "${show.name}" -> ${imdbId}`);
                            }
                        } catch (e) { }
                    }

                    // If registered, add to catalog
                    if (imdbId) {
                        console.log(`[Indexer] Found IMDb ID: ${imdbId} (${show.name})`);
                        await catalogService.registerShow(imdbId);
                    } else {
                        // console.log(`[Indexer] No IMDb ID for show: ${show.name}`);
                    }

                    // Throttle inner loop slightly to avoid hammer
                    await new Promise(r => setTimeout(r, 200));
                }

                offset += BATCH_SIZE;
                page++;

                // Throttle to avoid rate limits
                await new Promise(r => setTimeout(r, 1000));

            } catch (e) {
                console.error(`[Indexer] Error on page ${page}: ${e.message}`);
                running = false;
            }
        }
    }
}

module.exports = new IndexerService();
