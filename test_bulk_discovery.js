const axios = require('axios');
const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';

async function test() {
    const query = `
        query ($search: String) {
            searchShows(search: $search, limit: 10) {
                id
                name
            }
        }
    `;

    try {
        const res = await axios.post('https://api.anime-skip.com/graphql', {
            query: query,
            variables: { search: "" }
        }, {
            headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID }
        });

        console.log("Empty Search Results:", JSON.stringify(res.data.data.searchShows, null, 2));
    } catch (e) {
        console.error("Test Failed:", e.message);
    }
}

test();
