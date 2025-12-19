const axios = require('axios');

const ANIME_SKIP_CLIENT_ID = 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi';

async function testAnimeSkip() {
    console.log("--- Testing Anime-Skip Stats ---");
    const queryStats = `query { counts { timestamps } }`;
    try {
        const res = await axios.post('https://api.anime-skip.com/graphql',
            { query: queryStats },
            { headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID } }
        );
        console.log("Stats Success:", res.data.data.counts.timestamps);
    } catch (e) {
        console.error("Stats Failed");
    }

    console.log("\n--- Testing Anime-Skip Search ('One Piece') ---");
    const searchQuery = `
        query ($search: String!) {
            searchShows(search: $search) {
                id
                name
            }
        }
    `;

    try {
        const res = await axios.post('https://api.anime-skip.com/graphql', {
            query: searchQuery,
            variables: { search: "One Piece" }
        }, {
            headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID }
        });

        if (res.data && res.data.data && res.data.data.searchShows) {
            console.log("Search Results (first 2):", JSON.stringify(res.data.data.searchShows.slice(0, 2), null, 2));

            if (res.data.data.searchShows.length > 0) {
                const showId = res.data.data.searchShows[0].id;
                console.log(`\n--- Testing Episode Lookup for Show ID ${showId} ---`);
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
                    variables: { showId }
                }, {
                    headers: { 'X-Client-ID': ANIME_SKIP_CLIENT_ID }
                });

                const episodes = epRes.data.data.findEpisodesByShowId || [];
                console.log("Episodes Success (found):", episodes.length);
                if (episodes.length > 0) {
                    console.log("First episode preview:", JSON.stringify(episodes[0], null, 2));
                }
            }
        } else {
            console.log("Search Results: No data returned", JSON.stringify(res.data, null, 2));
        }
    } catch (e) {
        console.error("Lookup Failed:", e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}

testAnimeSkip();
