const axios = require('axios');

const TORBOX_API_URL = 'https://api.torbox.app/v1/api/torrents/search';

/**
 * Search TorBox for torrents by IMDb ID
 * @param {string} imdbId - The IMDb ID (e.g. tt1234567)
 * @param {string} apiToken - User's TorBox API Token
 * @returns {Promise<Array>} Array of stream objects compatible with IntroHater
 */
async function searchTorBox(imdbId, apiToken) {
    if (!apiToken) return [];

    console.log(`[TorBoxScraper] Searching for ${imdbId}`);

    try {
        // TorBox search query
        const url = `${TORBOX_API_URL}?query=${imdbId}&list=true`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${apiToken}` },
            timeout: 5000
        });

        if (!response.data || !response.data.data) {
            console.log(`[TorBoxScraper] No results format matches`);
            return [];
        }

        const results = response.data.data;
        console.log(`[TorBoxScraper] Found ${results.length} results`);

        // Map results to IntroHater stream format
        const streams = results.map(item => ({
            name: `[TB] ${item.resolution || 'Unknown'}`,
            title: `[TorBox] ${item.name}\n👤 ${item.seeders || 0} SE`,
            infoHash: item.hash,
            fileIdx: null, // We don't know file index yet, DebridResolver handles this
            behaviorHints: {
                bingeGroup: `torbox-${item.hash}`
            }
        }));

        return streams;

    } catch (e) {
        console.error(`[TorBoxScraper] Error: ${e.message}`);
        // Log response data if available for debugging
        if (e.response && e.response.data) {
            console.error(`[TorBoxScraper] API Response:`, e.response.data);
        }
        return [];
    }
}

module.exports = {
    searchTorBox
};
