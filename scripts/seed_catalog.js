require('dotenv').config();
const catalogService = require('../src/services/catalog');
const axios = require('axios');

// Popular Anime IMDB IDs to seed the catalog
const SEED_IDS = [
    'tt0160622', // Naruto
    'tt0123456', // Space Filler
    'tt0988824', // Steins;Gate
    'tt0409591', // Naruto: Shippuden
    'tt0388629', // One Piece
    'tt2306299', // Attack on Titan
    'tt0348735', // Fullmetal Alchemist: Brotherhood
    'tt0417299', // Hunter x Hunter (2011)
    'tt0280280', // Cowboy Bebop
    'tt0270442', // Death Note
    'tt0256860', // Hellsing
    'tt0169124', // Initial D
    'tt0206134', // Inuyasha
    'tt2357736', // Code Geass
];

async function seed() {
    console.log(`[Seed] Starting catalog seeding with ${SEED_IDS.length} items...`);

    for (const id of SEED_IDS) {
        try {
            console.log(`[Seed] Processing ${id}...`);
            // We register it as 'aniskip' source initially as a placeholder 
            // the service will fetch OMDB metadata and set flags
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
