const catalogService = require('./catalog');
const skipService = require('./skip-service');
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

                    // If registered, add to catalog AND fetch segments
                    if (imdbId) {
                        console.log(`[Indexer] Found IMDb ID: ${imdbId} (${show.name}). Fetching segments...`);
                        await catalogService.registerShow(imdbId);

                        // --- FETCH SEGMENTS ---
                        try {
                            const epQuery = `
                                query ($showId: ID!) {
                                    findEpisodesByShowId(showId: $showId) {
                                        number
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

                                    // Construct ID: tt123456:1:5 (Assuming Season 1 for simplicity if unknown, but usually AnimeSkip is absolute. Logic needed here?)
                                    // Limitation: AnimeSkip uses absolute episode numbers usually. 
                                    // We'll store as tt123456:1:X for now, but really we should try to map seasons.
                                    // For now, let's assume Season 1 for simple anime, or use absolute if needed. 
                                    // Actually, let's just use the absolute number as the episode and S1.
                                    // Note: This relies on the user playing S1EX. 
                                    const fullId = `${imdbId}:1:${ep.number}`;

                                    await skipService.addSkipSegment(fullId, start, end, 'Intro', 'auto-import', false, true); // skipSave = true
                                    importedCount++;
                                }
                            }

                            if (importedCount > 0) {
                                console.log(`[Indexer] Imported ${importedCount} segments for ${show.name}`);
                            }

                        } catch (err) {
                            console.error(`[Indexer] Failed to fetch segments for ${show.name}: ${err.message}`);
                        }

                    } else {
                        // console.log(`[Indexer] No IMDb ID for show: ${show.name}`);
                    }

                    // Throttle inner loop slightly to avoid hammer
                    await new Promise(r => setTimeout(r, 400)); // Increased delay for extra calls
                }

                // Save after batch
                // Save after batch (using outer scope skipService)
                await skipService.forceSave();

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
