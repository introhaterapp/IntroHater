require('dotenv').config();
const indexerService = require('../src/services/indexer');

async function trigger() {
    console.log('[Trigger] Manually triggering indexer cycle...');
    await indexerService.runIndex();
    console.log('[Trigger] Cycle finished.');
    process.exit(0);
}

trigger();
