const catalogService = require('./catalog');
const skipService = require('./skip-service');
const cacheRepository = require('../repositories/cache.repository');
const axios = require('axios');
const log = require('../utils/logger').indexer;

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
            log.error({ err: e.message }, 'Failed to save state');
        }
    }

    async runIndex() {
        if (this.isRunning) {
            log.info('Already running, skipping cycle');
            return;
        }

        this.isRunning = true;

        // Load State
        const state = await this.loadState();
        log.info({ page: state.page }, 'Starting catalog indexing cycle');

        try {
            await this.indexAnimeSkipCatalog(state);
            await this.indexIntroDBCatalog(); // Proactively scrape IntroDB for catalog shows
        } catch (e) {
            log.error({ err: e.message }, 'Cycle failed');
        } finally {
            this.isRunning = false;
            log.info('Indexing cycle complete');
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
                    log.info('No more shows found (empty result). Resetting indexer loop.');
                    await this.saveState({ page: 0, offset: 0, lastRun: new Date().toISOString() });
                    running = false;
                    break;
                }

                log.info({ page: page + 1, offset, showCount: shows.length }, 'Processing page');

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
                        } catch { /* ignore stremio search errors */ }
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
                                log.info({ count: importedCount, show: show.name, imdbId }, 'Imported segments');
                            }

                        } catch (err) {
                            log.error({ show: show.name, err: err.message }, 'Failed to fetch segments');
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
                log.error({ page, err: e.message }, 'Error on page');
                // Save state even on error to resume later
                await this.saveState({ page, offset, error: e.message, lastRun: new Date().toISOString() });
                running = false;
            }
        }
    }

    /**
     * Scrapes external TV catalogs (Cinemeta) and checks each show/episode against IntroDB.
     * This runs independently from your own catalog, discovering new shows from popular lists.
     * Progress is tracked so we can resume where we left off.
     */
    async indexIntroDBCatalog() {
        log.info('Starting IntroDB external catalog scrape...');

        const INTRODB_STATE_KEY = 'indexer:introdb_state';
        const MAX_SHOWS_PER_RUN = 50; // Process 50 shows per run to avoid timeout

        // Load state with statistics
        let state = await cacheRepository.getCache(INTRODB_STATE_KEY) || {
            showIndex: 0,
            checkedShows: [], // IMDb IDs we've fully processed
            lastRun: null,
            // Statistics (cumulative)
            stats: {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: new Date().toISOString()
            }
        };

        // Ensure stats object exists for older states
        if (!state.stats) {
            state.stats = {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: new Date().toISOString()
            };
        }

        // Reset cycle stats
        state.stats.lastCycleSegments = 0;

        try {
            // Fetch popular TV shows from multiple Cinemeta catalogs
            // Including genre-specific catalogs for broader coverage
            const catalogs = [
                // Main catalogs
                'https://v3-cinemeta.strem.io/catalog/series/top.json',
                'https://v3-cinemeta.strem.io/catalog/series/year.json',
                // Genre-specific for broader coverage
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Drama.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Comedy.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Action.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Thriller.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Sci-Fi.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Crime.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Horror.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Animation.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Fantasy.json',
                'https://v3-cinemeta.strem.io/catalog/series/top/genre=Mystery.json',
                // IMDB Top 250 TV
                'https://v3-cinemeta.strem.io/catalog/series/imdbRating.json'
            ];

            let allShows = [];

            for (const catalogUrl of catalogs) {
                // Fetch multiple pages from each catalog (100 shows per page)
                for (let skip = 0; skip < 500; skip += 100) {
                    try {
                        const paginatedUrl = catalogUrl.replace('.json', `/skip=${skip}.json`);
                        const res = await axios.get(paginatedUrl, { timeout: 10000 });
                        const metas = res.data?.metas || [];

                        if (metas.length === 0) break; // No more results

                        for (const meta of metas) {
                            if (meta.id && meta.id.startsWith('tt') && !allShows.includes(meta.id)) {
                                allShows.push(meta.id);
                            }
                        }

                        // Small delay between pagination requests
                        await new Promise(r => setTimeout(r, 100));
                    } catch (e) {
                        // Log only once per catalog, not per page
                        if (skip === 0) {
                            log.warn({ catalog: catalogUrl, err: e.message }, 'Failed to fetch catalog');
                        }
                        break; // Stop pagination on error
                    }
                }
            }

            log.info({ totalShows: allShows.length, alreadyChecked: state.checkedShows.length }, 'Found shows to check against IntroDB');

            // Filter out already-checked shows
            const uncheckedShows = allShows.filter(id => !state.checkedShows.includes(id));

            if (uncheckedShows.length === 0) {
                log.info('All known shows have been checked. Resetting state for next cycle.');
                await cacheRepository.setCache(INTRODB_STATE_KEY, {
                    showIndex: 0,
                    checkedShows: [],
                    lastRun: new Date().toISOString()
                });
                return;
            }

            // Process a batch of shows
            const showsToProcess = uncheckedShows.slice(0, MAX_SHOWS_PER_RUN);
            let totalFound = 0;

            for (const imdbId of showsToProcess) {
                try {
                    log.info({ imdbId }, 'Checking show against IntroDB');

                    // Get episode metadata from Cinemeta
                    let showMeta = null;
                    try {
                        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { timeout: 10000 });
                        showMeta = metaRes.data?.meta;
                    } catch (e) {
                        log.warn({ imdbId, err: e.message }, 'Failed to fetch show metadata');
                    }

                    // Determine seasons/episodes to check
                    let episodesToCheck = [];

                    if (showMeta && showMeta.videos && showMeta.videos.length > 0) {
                        // Use actual episode list from Cinemeta
                        for (const video of showMeta.videos) {
                            if (video.season && video.episode) {
                                episodesToCheck.push({ s: video.season, e: video.episode });
                            }
                        }
                    } else {
                        // Fallback: Generate a reasonable range (S1-S5, E1-E20)
                        for (let s = 1; s <= 5; s++) {
                            for (let e = 1; e <= 20; e++) {
                                episodesToCheck.push({ s, e });
                            }
                        }
                    }

                    // Check each episode against IntroDB
                    let foundForShow = 0;
                    let consecutiveMisses = 0;
                    let episodesCheckedForShow = 0;

                    for (const ep of episodesToCheck) {
                        try {
                            const fullId = `${imdbId}:${ep.s}:${ep.e}`;
                            const result = await skipService.getSkipSegment(fullId);
                            episodesCheckedForShow++;

                            if (result && result.source === 'introdb') {
                                foundForShow++;
                                totalFound++;
                                state.stats.totalSegmentsImported++;
                                state.stats.lastCycleSegments++;
                                consecutiveMisses = 0;
                                log.info({ fullId, start: result.start, end: result.end }, 'Found IntroDB segment');
                            } else {
                                consecutiveMisses++;
                            }

                            // Early exit if too many consecutive misses for this season
                            if (consecutiveMisses >= 5) {
                                // Skip remaining episodes of this season
                                break;
                            }

                            // Rate limit: 200ms between requests
                            await new Promise(r => setTimeout(r, 200));

                        } catch (epErr) {
                            log.error({ imdbId, season: ep.s, episode: ep.e, err: epErr.message }, 'Episode check failed');
                        }
                    }

                    // Update cumulative episode count
                    state.stats.totalEpisodesChecked += episodesCheckedForShow;

                    if (foundForShow > 0) {
                        log.info({ imdbId, count: foundForShow }, 'Imported IntroDB segments for show');
                        state.stats.showsWithData++;
                        // Register show in catalog
                        await catalogService.registerShow(imdbId);
                    }

                    // Mark show as checked
                    state.checkedShows.push(imdbId);

                } catch (showErr) {
                    log.error({ imdbId, err: showErr.message }, 'Show processing failed');
                    // Still mark as checked to avoid infinite retry
                    state.checkedShows.push(imdbId);
                }

                // Save state periodically
                await cacheRepository.setCache(INTRODB_STATE_KEY, {
                    ...state,
                    lastRun: new Date().toISOString()
                });

                // Throttle between shows
                await new Promise(r => setTimeout(r, 500));
            }

            log.info({ processedShows: showsToProcess.length, totalFound }, 'IntroDB batch complete');

        } catch (e) {
            log.error({ err: e.message }, 'IntroDB catalog scrape failed');
        }

        log.info('IntroDB indexing complete');
    }

    /**
     * Get current IntroDB indexer state for admin dashboard
     */
    async getIntroDBState() {
        const INTRODB_STATE_KEY = 'indexer:introdb_state';
        const state = await cacheRepository.getCache(INTRODB_STATE_KEY) || {
            showIndex: 0,
            checkedShows: [],
            lastRun: null,
            stats: {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: null
            }
        };
        return {
            checkedShowsCount: state.checkedShows.length,
            lastRun: state.lastRun,
            isRunning: this.isRunning,
            recentlyChecked: state.checkedShows.slice(-10), // Last 10 checked shows
            stats: state.stats || {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: null
            }
        };
    }

    /**
     * Manually trigger IntroDB indexing (admin only)
     */
    async triggerIntroDBIndex() {
        if (this.isRunning) {
            return { success: false, message: 'Indexer is already running' };
        }

        // Run in background
        this.indexIntroDBCatalog().catch(e => {
            log.error({ err: e.message }, 'Manual IntroDB trigger failed');
        });

        return { success: true, message: 'IntroDB indexing started' };
    }

    /**
     * Reset IntroDB indexer state (admin only)
     */
    async resetIntroDBState() {
        const INTRODB_STATE_KEY = 'indexer:introdb_state';
        await cacheRepository.setCache(INTRODB_STATE_KEY, {
            showIndex: 0,
            checkedShows: [],
            lastRun: null
        });
        return { success: true, message: 'IntroDB state reset' };
    }
}

module.exports = new IndexerService();
