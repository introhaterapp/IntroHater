const SECURITY = {
    TOKEN: {
        MAX_AGE_DAYS: 30,
        MIN_LENGTH: 32,
    },
    RATE_LIMITS: {
        GLOBAL: {
            WINDOW_MS: 60 * 60 * 1000,
            MAX_REQUESTS: 5000
        },
        SUBMIT: {
            WINDOW_MS: 15 * 60 * 1000,
            MAX_REQUESTS: 10
        },
        REPORT: {
            WINDOW_MS: 15 * 60 * 1000,
            MAX_REQUESTS: 5
        },
        SUBMISSION: {
            WINDOW_MS: 60 * 60 * 1000,
            MAX_REQUESTS: 5,
            MIN_GAP_MS: 2000
        },
        VOTING: {
            WINDOW_MS: 60 * 60 * 1000,
            MAX_REQUESTS: 5
        }
    },
    SHUTDOWN: {
        FORCE_TIMEOUT_MS: 10000,
        MAINTENANCE_DELAY_MS: 60000
    }
};

const SEGMENTS = {
    DURATION: {
        MIN: 5,
        MAX: 300
    },
    GROUPING: {
        TIME_THRESHOLD: 10,
        MIN_VOTES: -3,
        MIN_VOTE_RATIO: -1
    }
};

const CACHE = {
    LEADERBOARD: {
        MAX_AGE_MS: 3600000
    }
};

const BATCH = {
    MAX_SIZE: 500
};

const SUBMISSION = {
    CHECK_EXPIRY_MS: 24 * 60 * 60 * 1000,
    UNIQUE_PER_VIDEO: true
};

const MAINTENANCE = {
    INTERVAL_MS: 24 * 60 * 60 * 1000,
    STARTUP_DELAY_MS: 60 * 1000
};


const REQUIRED_ENV_VARS = [
    'MONGODB_URI',
    'TOKEN_SECRET',
    'ADMIN_EMAILS'
];


const OPTIONAL_ENV_VARS = [
    'PORT',
    'PUBLIC_URL',
    'OMDB_API_KEY',
    'ANIME_SKIP_CLIENT_ID',
    'AUTH0_CLIENT_ID',
    'AUTH0_ISSUER_BASE_URL',
];


function validateEnv() {
    const missing = [];
    const warnings = [];


    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
        }
    }


    for (const varName of OPTIONAL_ENV_VARS) {
        if (!process.env[varName]) {
            warnings.push(varName);
        }
    }


    if (warnings.length > 0) {
        console.warn(`⚠️  Optional environment variables not set: ${warnings.join(', ')}`);
    }


    if (missing.length > 0) {
        console.error('\n❌ FATAL: Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('\n   Please set these in your .env file or environment.');
        console.error('   See .env.example for reference.\n');
        process.exit(1);
    }

    // Additional validation for OIDC
    const issuer = process.env.AUTH0_ISSUER_BASE_URL;
    const clientId = process.env.AUTH0_CLIENT_ID;
    if (clientId && issuer) {
        try {
            const url = new URL(issuer);
            if (url.protocol !== 'https:') {
                console.warn(`⚠️  AUTH0_ISSUER_BASE_URL should use HTTPS: ${issuer}`);
            }
            // Check if it's likely a misconfigured local URL
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.includes('introhater.com')) {
                console.warn(`⚠️  AUTH0_ISSUER_BASE_URL looks like a local or app-specific URL: ${issuer}. It should typically be your Auth0 domain (e.g., https://dev-xxxx.us.auth0.com).`);
            }
            // Check for common incorrect suffixes
            if (url.pathname !== '/' && url.pathname !== '') {
                console.warn(`⚠️  AUTH0_ISSUER_BASE_URL contains a path suffix (${url.pathname}). It should usually just be the base domain (e.g., https://dev-xxxx.us.auth0.com).`);
            }
        } catch {
            console.error(`❌ INVALID AUTH0_ISSUER_BASE_URL: ${issuer}. Must be a valid URL.`);
        }
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
    REFRESH_INTERVAL_MS: 15 * 60 * 1000
};

const MANIFEST = {
    ID: "org.introhater",
    VERSION: "2.0.0",
    NAME: "IntroHater",
    DESCRIPTION: "Universal Skip Intro for Stremio (TV/Mobile/PC)",
    resources: ["stream"],
    types: ["movie", "series", "anime"],
    idPrefixes: ["tt"]
};

const PROBE = {
    TIMEOUT_MS: 15000,
    SPLICE_TIMEOUT_MS: 20000,
    CHAPTER_TIMEOUT_MS: 10000,
    CACHE_TTL_MS: 30 * 60 * 1000
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