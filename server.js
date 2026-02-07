

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');
const { auth } = require('express-openid-connect');

const rateLimit = require('express-rate-limit');
const log = require('./src/utils/logger').server;


const { SECURITY, SERVER, validateEnv } = require('./src/config/constants');


const ffmpeg = require('fluent-ffmpeg');
if (process.platform === 'win32') {
    try {
        const ffmpegPath = require('ffmpeg-static');
        const ffprobePath = require('ffprobe-static').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    } catch { log.info("Using system ffmpeg"); }
} else {
    ffmpeg.setFfmpegPath('ffmpeg');
    ffmpeg.setFfprobePath('ffprobe');
}


const indexerService = require('./src/services/indexer');
const wsTicker = require('./src/services/ws-ticker');


const apiRoutes = require('./src/routes/api');
const v1Routes = require('./src/routes/v1');
const apiKeyRoutes = require('./src/routes/apiKeys');
const hlsRoutes = require('./src/routes/hls');
const addonRoutes = require('./src/routes/addon');



const app = express();
const PORT = SERVER.PORT;
const PUBLIC_URL = SERVER.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// OIDC Configuration
const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.TOKEN_SECRET || 'a_very_long_random_string_for_session_encryption',
    baseURL: PUBLIC_URL,
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
};

// Global status for diagnostics
const oidcStatus = {
    configured: !!(config.clientID && config.issuerBaseURL),
    discovery: {
        status: 'pending',
        lastChecked: null,
        error: null,
        url: config.issuerBaseURL ? `${config.issuerBaseURL.replace(/\/$/, '')}/.well-known/openid-configuration` : null
    },
    config: {
        hasClientId: !!config.clientID,
        hasIssuer: !!config.issuerBaseURL,
        hasSecret: !!process.env.TOKEN_SECRET,
        baseURL: config.baseURL
    }
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
if (config.clientID && config.issuerBaseURL) {
    app.use(auth(config));
    // Verify discovery endpoint asynchronously
    async function verifyOidcDiscovery(issuerBaseURL) {
        oidcStatus.discovery.lastChecked = new Date().toISOString();
        try {
            const discoveryURL = `${issuerBaseURL.replace(/\/$/, '')}/.well-known/openid-configuration`;
            log.info({ url: discoveryURL }, 'Verifying OIDC discovery...');
            const response = await axios.get(discoveryURL, { timeout: 5000 });
            if (response.status === 200) {
                log.info('✅ OIDC discovery successful');
                oidcStatus.discovery.status = 'success';
                oidcStatus.discovery.error = null;
            } else {
                log.warn(`⚠️ OIDC discovery returned status ${response.status}`);
                oidcStatus.discovery.status = 'warning';
                oidcStatus.discovery.error = `HTTP ${response.status}`;
            }
        } catch (e) {
            log.error({ err: e.message }, '❌ OIDC discovery failed. OIDC login will likely fail.');
            oidcStatus.discovery.status = 'failed';
            oidcStatus.discovery.error = e.message;
            if (e.response) {
                log.error({
                    status: e.response.status,
                    data: e.response.data
                }, 'OIDC Discovery Error Details');
                oidcStatus.discovery.details = {
                    status: e.response.status,
                    data: e.response.data
                };
            }
        }
    }
    verifyOidcDiscovery(config.issuerBaseURL);
} else {
    log.info('Auth0 (OIDC) not configured. API Console auth will be disabled.');
}


app.set('trust proxy', 1);


app.use(morgan(':remote-addr :method :url :status :response-time ms - :res[content-length]'));


app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.datatables.net", "https://code.jquery.com", "https://static.cloudflareinsights.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.datatables.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://www.omdbapi.com", "wss:", "ws:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
        }
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(hpp());
app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

app.use(express.json({ limit: '1mb' }));


const globalLimiter = rateLimit({
    windowMs: SECURITY.RATE_LIMITS.GLOBAL.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.GLOBAL.MAX_REQUESTS,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/', globalLimiter);




app.use(express.static(path.join(__dirname, 'docs')));





app.use('/api/v1', v1Routes);
app.use('/api/keys', apiKeyRoutes);

// Auth diagnostics
app.get('/api/auth/status', (req, res) => {
    res.json(oidcStatus);
});

app.use('/api', apiRoutes);


app.use('/', hlsRoutes);

app.use('/', addonRoutes);




app.get('/api/me', (req, res) => {
    if (req.oidc && req.oidc.isAuthenticated()) {
        res.json(req.oidc.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.get('/me', (req, res) => res.json(req.oidc ? (req.oidc.user || null) : null));


app.get('/ping', (req, res) => res.send('pong'));


const { errorHandler, setupGlobalErrorHandlers } = require('./src/middleware/errorHandler');
setupGlobalErrorHandlers();
app.use(errorHandler);


app.use((req, res) => {
    res.status(404).json({ success: false, error: "Route not found", path: req.path });
});




const mongoService = require('./src/services/mongodb');

function gracefulShutdown(signal, server) {
    log.info({ signal }, 'Received shutdown signal. Shutting down gracefully...');


    wsTicker.close();

    server.close(async () => {
        log.info('HTTP server closed');

        try {
            await mongoService.close();
            log.info('MongoDB connection closed');
        } catch (e) {
            log.error({ err: e.message }, 'Error closing MongoDB');
        }

        log.info('Goodbye!');
        process.exit(0);
    });


    setTimeout(() => {
        log.error('Force shutdown after timeout');
        process.exit(1);
    }, 10000);
}

if (require.main === module) {

    validateEnv();


    try {
        indexerService.start();
    } catch (e) { log.error({ err: e }, 'Failed to start indexer'); }

    const server = app.listen(PORT, () => {
        log.info({ port: PORT, publicUrl: PUBLIC_URL }, 'IntroHater running');
    });


    wsTicker.init(server);


    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));
}

module.exports = app;
