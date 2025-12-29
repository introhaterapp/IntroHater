require('dotenv').config();
const catalogService = require('../src/services/catalog');


const SEED_IDS = [
    'tt0160622', 
    'tt0123456', 
    'tt0988824', 
    'tt0409591', 
    'tt0388629', 
    'tt2306299', 
    'tt0348735', 
    'tt0417299', 
    'tt0280280', 
    'tt0270442', 
    'tt0256860', 
    'tt0169124', 
    'tt0206134', 
    'tt2357736', 
];

async function seed() {
    console.log(`[Seed] Starting catalog seeding with ${SEED_IDS.length} items...`);

    for (const id of SEED_IDS) {
        try {
            console.log(`[Seed] Processing ${id}...`);
            
            
            await catalogService.registerShow(id, 'aniskip');
            console.log(`[Seed] Successfully registered ${id}`);
        } catch (e) {
            console.error(`[Seed] Failed to register ${id}: ${e.message}`);
        }
    }

    console.log('[Seed] Seeding complete!');
    process.exit(0);
}

seed();
