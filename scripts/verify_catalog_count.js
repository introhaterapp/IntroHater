require('dotenv').config();
const catalogService = require('../src/services/catalog');

async function verify() {
    console.log('[Verify] Fetching catalog data...');
    const data = await catalogService.getCatalogData();
    const count = Object.keys(data.media).length;
    console.log(`[Verify] Total Shows in Catalog: ${count}`);

    // Check a sample
    const sampleId = 'tt0388629'; // One Piece
    if (data.media[sampleId]) {
        console.log(`[Verify] Sample (One Piece): Found`);
    } else {
        console.log(`[Verify] Sample (One Piece): NOT Found`);
    }
    process.exit(0);
}

verify();
