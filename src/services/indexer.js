const catalogService = require('./catalog');
const skipService = require('./skip-service');
const cacheRepository = require('../repositories/cache.repository');
const axios = require('axios');
const log = require('../utils/logger').indexer;

class IndexerService {
    constructor() {
        this.isRunning = false;
        this.interval = 12 * 60 * 60 * 1000;
        this.STATE_KEY = 'indexer:state';
    }

    start() {

        this.runIndex();


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


        const state = await this.loadState();
        log.info({ page: state.page }, 'Starting catalog indexing cycle');

        try {
            await this.indexAnimeSkipCatalog(state);
            await this.indexIntroDBCatalog();
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
        const MAX_PAGES = 100;

        let offset = initialState.offset || 0;
        let page = initialState.page || 0;
        let running = true;

        while (running && page < MAX_PAGES) {
            try {

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

                    if (show.externalLinks) {
                        const imdbLink = show.externalLinks.find(e => e.service === 'IMDB' || (e.url && e.url.includes('imdb.com/title/')));
                        if (imdbLink && imdbLink.url) {

                            const match = imdbLink.url.match(/(tt\d+)/);
                            if (match) imdbId = match[1];
                        }
                    }


                    if (!imdbId && show.name) {
                        try {
                            const searchUrl = `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(show.name)}.json`;
                            const searchRes = await axios.get(searchUrl);
                            if (searchRes.data?.metas?.length > 0) {
                                imdbId = searchRes.data.metas[0].id;
                            }
                        } catch { }
                    }


                    if (imdbId) {
                        await catalogService.registerShow(imdbId);


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



                                    const season = ep.season || 1;
                                    const epNum = ep.number || 0;
                                    const fullId = `${imdbId}:${season}:${epNum}`;


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


                    await new Promise(r => setTimeout(r, 200));
                }

                offset += BATCH_SIZE;
                page++;


                await this.saveState({ page, offset, lastRun: new Date().toISOString() });


                await new Promise(r => setTimeout(r, 1000));

            } catch (e) {
                log.error({ page, err: e.message }, 'Error on page');

                await this.saveState({ page, offset, error: e.message, lastRun: new Date().toISOString() });
                running = false;
            }
        }
    }


    async indexIntroDBCatalog() {
        log.info('Starting IntroDB external catalog scrape...');

        const INTRODB_STATE_KEY = 'indexer:introdb_state';
        const MAX_SHOWS_PER_RUN = 50;


        let state = await cacheRepository.getCache(INTRODB_STATE_KEY) || {
            showIndex: 0,
            checkedShows: [],
            lastRun: null,

            stats: {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: new Date().toISOString()
            }
        };


        if (!state.stats) {
            state.stats = {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: new Date().toISOString()
            };
        }


        state.stats.lastCycleSegments = 0;

        try {


            const catalogs = [

                'https://v3-cinemeta.strem.io/catalog/series/top.json',
                'https://v3-cinemeta.strem.io/catalog/series/year.json',

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

                'https://v3-cinemeta.strem.io/catalog/series/imdbRating.json'
            ];

            let allShows = [];

            for (const catalogUrl of catalogs) {

                for (let skip = 0; skip < 500; skip += 100) {
                    try {
                        const paginatedUrl = catalogUrl.replace('.json', `/skip=${skip}.json`);
                        const res = await axios.get(paginatedUrl, { timeout: 10000 });
                        const metas = res.data?.metas || [];

                        if (metas.length === 0) break;

                        for (const meta of metas) {
                            if (meta.id && meta.id.startsWith('tt') && !allShows.includes(meta.id)) {
                                allShows.push(meta.id);
                            }
                        }


                        await new Promise(r => setTimeout(r, 100));
                    } catch (e) {

                        if (skip === 0) {
                            log.warn({ catalog: catalogUrl, err: e.message }, 'Failed to fetch catalog');
                        }
                        break;
                    }
                }
            }

            log.info({ totalShows: allShows.length, alreadyChecked: state.checkedShows.length }, 'Found shows to check against IntroDB');


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


            const showsToProcess = uncheckedShows.slice(0, MAX_SHOWS_PER_RUN);
            let totalFound = 0;

            for (const imdbId of showsToProcess) {
                try {
                    log.info({ imdbId }, 'Checking show against IntroDB');


                    let showMeta = null;
                    try {
                        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { timeout: 10000 });
                        showMeta = metaRes.data?.meta;
                    } catch (e) {
                        log.warn({ imdbId, err: e.message }, 'Failed to fetch show metadata');
                    }


                    let episodesToCheck = [];

                    if (showMeta && showMeta.videos && showMeta.videos.length > 0) {

                        for (const video of showMeta.videos) {
                            if (video.season && video.episode) {
                                episodesToCheck.push({ s: video.season, e: video.episode });
                            }
                        }
                    } else {

                        for (let s = 1; s <= 5; s++) {
                            for (let e = 1; e <= 20; e++) {
                                episodesToCheck.push({ s, e });
                            }
                        }
                    }


                    let foundForShow = 0;
                    let consecutiveMisses = 0;
                    let episodesCheckedForShow = 0;

                    for (const ep of episodesToCheck) {
                        try {
                            const epNum = ep.e || 0;
                            const fullId = `${imdbId}:${ep.s || 1}:${epNum}`;
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


                            if (consecutiveMisses >= 5) {

                                break;
                            }


                            await new Promise(r => setTimeout(r, 200));

                        } catch (epErr) {
                            log.error({ imdbId, season: ep.s, episode: ep.e, err: epErr.message }, 'Episode check failed');
                        }
                    }


                    state.stats.totalEpisodesChecked += episodesCheckedForShow;

                    if (foundForShow > 0) {
                        log.info({ imdbId, count: foundForShow }, 'Imported IntroDB segments for show');
                        state.stats.showsWithData++;

                        await catalogService.registerShow(imdbId);
                    }


                    state.checkedShows.push(imdbId);

                } catch (showErr) {
                    log.error({ imdbId, err: showErr.message }, 'Show processing failed');

                    state.checkedShows.push(imdbId);
                }


                await cacheRepository.setCache(INTRODB_STATE_KEY, {
                    ...state,
                    lastRun: new Date().toISOString()
                });


                await new Promise(r => setTimeout(r, 500));
            }

            log.info({ processedShows: showsToProcess.length, totalFound }, 'IntroDB batch complete');

        } catch (e) {
            log.error({ err: e.message }, 'IntroDB catalog scrape failed');
        }

        log.info('IntroDB indexing complete');
    }


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
            recentlyChecked: state.checkedShows.slice(-10),
            stats: state.stats || {
                totalSegmentsImported: 0,
                totalEpisodesChecked: 0,
                showsWithData: 0,
                lastCycleSegments: 0,
                startedAt: null
            }
        };
    }


    async triggerIntroDBIndex() {
        if (this.isRunning) {
            return { success: false, message: 'Indexer is already running' };
        }


        this.indexIntroDBCatalog().catch(e => {
            log.error({ err: e.message }, 'Manual IntroDB trigger failed');
        });

        return { success: true, message: 'IntroDB indexing started' };
    }


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
