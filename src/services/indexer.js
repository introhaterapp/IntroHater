const catalogService = require('./catalog');
const skipService = require('./skip-service');
const cacheRepository = require('../repositories/cache.repository');
const axios = require('axios');

class IndexerService {
    constructor() {
        this.isRunning = false;
        this.interval = 12 * 60 * 60 * 1000; // 12 Hours
        this.STATE_KEY = 'indexer:state';
    }

    start() {
        // Run immediately on start
        this.runIndex();

        // Schedule periodic runs
        setInterval(() => this.runIndex(), this.interval);
    }

    async loadState() {
        const state = await cacheRepository.getCache(this.STATE_KEY);
        return state || { page: 0, offset: 0, lastRun: null };
    }

    async saveState(state) {
        try {
            await cacheRepository.setCache(this.STATE_KEY, state);
        } catch (e) {
            console.error('[Indexer] Failed to save state:', e.message);
        }
    }

    async runIndex() {
        if (this.isRunning) {
            console.log('[Indexer] Already running, skipping cycle.');
            return;
        }

        this.isRunning = true;

        // Load State
        const state = await this.loadState();
        console.log(`[Indexer] Starting catalog indexing cycle (Resuming from Page ${state.page})...`);

        try {
            await this.indexAnimeSkipCatalog(state);
        } catch (e) {
            console.error(`[Indexer] Cycle failed: ${e.message}`);
        } finally {
            this.isRunning = false;
            console.log('[Indexer] Indexing cycle complete.');
        }
    }

    async indexAnimeSkipCatalog(initialState) {
        const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';
        const BATCH_SIZE = 50;
        const MAX_PAGES = 100; // Increased limit to cover more shows over time

        let offset = initialState.offset || 0;
        let page = initialState.page || 0;
        let running = true;

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
                    console.log('[Indexer] No more shows found (empty result). Resetting indexer loop.');
                    await this.saveState({ page: 0, offset: 0, lastRun: new Date().toISOString() });
                    running = false;
                    break;
                }

                console.log(`[Indexer] Processing page ${page + 1} (Offset: ${offset}, Shows: ${shows.length})...`);

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
                            }
                        } catch (e) { }
                    }

                    // If registered, add to catalog AND fetch segments
                    if (imdbId) {
                        await catalogService.registerShow(imdbId);

                        // --- FETCH SEGMENTS ---
                        try {
                            const epQuery = `
                                query ($showId: ID!) {
                                    findEpisodesByShowId(showId: $showId) {
                                        number
                                        season
                                        timestamps {
                                            at
                                            type {
                                                name
                                            }
                                        }
                                    }
                                }
                            `;
                            const epRes = await axios.post('https://api.anime-skip.com/graphql', {
                                query: epQuery,
                                variables: { showId: show.id }
                            }, { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } });


                            const episodes = epRes.data?.data?.findEpisodesByShowId || [];
                            let importedCount = 0;

                            for (const ep of episodes) {
                                const timestamps = ep.timestamps || [];
                                const intro = timestamps.find(t => t.type.name.toLowerCase().includes('opening') || t.type.name.toLowerCase().includes('intro'));

                                if (intro) {
                                    const currentIndex = timestamps.indexOf(intro);
                                    const next = timestamps[currentIndex + 1];
                                    const start = intro.at;
                                    const end = next ? next.at : start + 90;

                                    // Construct ID: tt123456:1:5 (Dynamic season from API)
                                    const season = ep.season || 1;
                                    const fullId = `${imdbId}:${season}:${ep.number}`;

                                    // Use new duplicate-safe add method
                                    await skipService.addSkipSegment(fullId, start, end, 'Intro', 'auto-import', false);

                                    importedCount++;
                                }
                            }

                            if (importedCount > 0) {
                                console.log(`[Indexer] Imported ${importedCount} segments for ${show.name} (${imdbId})`);
                            }

                        } catch (err) {
                            console.error(`[Indexer] Failed to fetch segments for ${show.name}: ${err.message}`);
                        }

                    }

                    // Throttle inner loop slightly to avoid hammer
                    await new Promise(r => setTimeout(r, 200));
                }

                offset += BATCH_SIZE;
                page++;

                // Save State Checkpoint
                await this.saveState({ page, offset, lastRun: new Date().toISOString() });

                // Throttle to avoid rate limits
                await new Promise(r => setTimeout(r, 1000));

            } catch (e) {
                console.error(`[Indexer] Error on page ${page}: ${e.message}`);
                // Save state even on error to resume later
                await this.saveState({ page, offset, error: e.message, lastRun: new Date().toISOString() });
                running = false;
            }
        }
    }
}

module.exports = new IndexerService();
