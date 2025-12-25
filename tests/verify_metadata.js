require('dotenv').config();
const catalogService = require('../src/services/catalog');

async function test() {
    console.log("Testing metadata resolution for tt0944947 (Game of Thrones)...");
    try {
        const data = await catalogService.fetchMetadata('tt0944947');
        console.log("Result:", JSON.stringify(data, null, 2));

        if (data && data.Title && data.Title !== 'tt0944947') {
            console.log("✅ Metadata resolution successful!");
        } else {
            console.error("❌ Metadata resolution failed or returned ID as title.");
        }
    } catch (e) {
        console.error("❌ Test error:", e);
    }
}

test();
