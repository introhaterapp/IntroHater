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

const REQUIRED_ENV_VARS = [
    'ORACLE_REGION',
    'ORACLE_COMPARTMENT_ID',
    'TOKEN_SECRET',
    'AUTH0_CLIENT_ID',
    'AUTH0_CLIENT_SECRET',
    'AUTH0_DOMAIN',
    'BASE_URL',
    'ADMIN_EMAILS'  // Add ADMIN_EMAILS as a required environment variable
];

const OMDB = {
    API_KEY: process.env.OMDB_API_KEY,
    BASE_URL: 'https://www.omdbapi.com'
};

const ANIME_SKIP = {
    CLIENT_ID: process.env.ANIME_SKIP_CLIENT_ID || 'th2oogUKrgOf1J8wMSIUPV0IpBMsLOJi',
    BASE_URL: 'https://api.anime-skip.com/graphql'
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

module.exports = {
    SECURITY,
    SEGMENTS,
    CACHE,
    BATCH,
    SUBMISSION,
    MAINTENANCE,
    REQUIRED_ENV_VARS,
    OMDB,
    ANIME_SKIP,
    SERVER,
    STATS,
    MANIFEST
};