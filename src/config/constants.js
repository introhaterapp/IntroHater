const SECURITY = {
    TOKEN: {
        MAX_AGE_DAYS: 30,
        MIN_LENGTH: 32,
    },
    RATE_LIMITS: {
        GLOBAL: {
            WINDOW_MS: 60 * 60 * 1000, // 1 hour
            MAX_REQUESTS: 5000
        },
        SUBMIT: {
            WINDOW_MS: 15 * 60 * 1000, // 15 minutes
            MAX_REQUESTS: 10
        },
        REPORT: {
            WINDOW_MS: 15 * 60 * 1000, // 15 minutes
            MAX_REQUESTS: 5
        },
        SUBMISSION: {
            WINDOW_MS: 60 * 60 * 1000, // 1 hour
            MAX_REQUESTS: 5,
            MIN_GAP_MS: 2000 // Minimum gap between submissions
        },
        VOTING: {
            WINDOW_MS: 60 * 60 * 1000, // Changed to 1 hour
            MAX_REQUESTS: 5
        }
    },
    SHUTDOWN: {
        FORCE_TIMEOUT_MS: 10000, // 10 seconds
        MAINTENANCE_DELAY_MS: 60000 // 1 minute
    }
};

const SEGMENTS = {
    DURATION: {
        MIN: 5,  // 5 seconds
        MAX: 300 // 5 minutes
    },
    GROUPING: {
        TIME_THRESHOLD: 10,
        MIN_VOTES: -3,
        MIN_VOTE_RATIO: -1
    }
};

const CACHE = {
    LEADERBOARD: {
        MAX_AGE_MS: 3600000 // 1 hour
    }
};

const BATCH = {
    MAX_SIZE: 500
};

const SUBMISSION = {
    CHECK_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
    UNIQUE_PER_VIDEO: true // Restrict to one submission per video per user
};

const MAINTENANCE = {
    INTERVAL_MS: 24 * 60 * 60 * 1000, // Daily
    STARTUP_DELAY_MS: 60 * 1000 // 1 minute after startup
};

// Updated for current MongoDB deployment (Critical Priority Rank 3)
const REQUIRED_ENV_VARS = [
    'MONGODB_URI',      // MongoDB connection string
    'TOKEN_SECRET',     // JWT Secret for user tokens
    'ADMIN_EMAILS'      // Comma-separated admin emails
];

// Optional but recommended env vars (warnings only)
const OPTIONAL_ENV_VARS = [
    'PORT',             // Server port (default: 7005)
    'PUBLIC_URL',       // Public URL for manifest
    'OMDB_API_KEY',     // For movie metadata lookups
    'ANIME_SKIP_CLIENT_ID', // For anime-skip API
];

/**
 * Validates environment variables on startup.
 * Fails fast with clear error messages for missing required configuration.
 */
function validateEnv() {
    const missing = [];
    const warnings = [];

    // Check required vars
    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
        }
    }

    // Check optional vars (warnings only)
    for (const varName of OPTIONAL_ENV_VARS) {
        if (!process.env[varName]) {
            warnings.push(varName);
        }
    }

    // Log warnings for optional vars
    if (warnings.length > 0) {
        console.warn(`⚠️  Optional environment variables not set: ${warnings.join(', ')}`);
    }

    // Fail fast on missing required vars
    if (missing.length > 0) {
        console.error('\n❌ FATAL: Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('\n   Please set these in your .env file or environment.');
        console.error('   See .env.example for reference.\n');
        process.exit(1);
    }

    console.log('✅ Environment validation passed');
}

const OMDB = {
    API_KEY: process.env.OMDB_API_KEY,
    BASE_URL: 'https://www.omdbapi.com'
};

const ANIME_SKIP = {
    CLIENT_ID: process.env.ANIME_SKIP_CLIENT_ID || 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi',
    BASE_URL: 'https://api.anime-skip.com/graphql'
};

const INTRO_DB = {
    BASE_URL: 'https://api.introdb.app'
};

const SERVER = {
    PORT: process.env.PORT || 7005,
    PUBLIC_URL: process.env.PUBLIC_URL
};

const STATS = {
    ANISKIP_ESTIMATE: 145000,
    REFRESH_INTERVAL_MS: 15 * 60 * 1000  // 15 minutes
};

const MANIFEST = {
    ID: "org.introhater",
    VERSION: "1.0.0",
    NAME: "IntroHater",
    DESCRIPTION: "Universal Skip Intro for Stremio (TV/Mobile/PC)"
};

const PROBE = {
    TIMEOUT_MS: 15000,           // Default ffprobe timeout
    SPLICE_TIMEOUT_MS: 20000,    // Splice probe timeout
    CHAPTER_TIMEOUT_MS: 10000,   // Chapter probe timeout
    CACHE_TTL_MS: 30 * 60 * 1000 // 30 minutes cache TTL
};

module.exports = {
    SECURITY,
    SEGMENTS,
    CACHE,
    BATCH,
    SUBMISSION,
    MAINTENANCE,
    REQUIRED_ENV_VARS,
    OPTIONAL_ENV_VARS,
    validateEnv,
    OMDB,
    ANIME_SKIP,
    INTRO_DB,
    SERVER,
    STATS,
    MANIFEST,
    PROBE
};