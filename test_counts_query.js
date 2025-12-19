const axios = require('axios');

async function testCounts() {
    const query = `
    {
      counts {
        shows
        episodes
        timestamps
      }
    }
    `;

    try {
        console.log("Testing text counts query...");
        const response = await axios.post('https://api.anime-skip.com/graphql', {
            query: query
        }, {
            headers: {
                'X-Client-ID': 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi'
            }
        });

        console.log("Response:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error.message);
    }
}

testCounts();
