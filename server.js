

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');

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
const hlsRoutes = require('./src/routes/hls');
const addonRoutes = require('./src/routes/addon');



const app = express();
const PORT = SERVER.PORT;
const PUBLIC_URL = SERVER.PUBLIC_URL || `http://127.0.0.1:${PORT}`;


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

app.use(express.json());


const globalLimiter = rateLimit({
    windowMs: SECURITY.RATE_LIMITS.GLOBAL.WINDOW_MS,
    max: SECURITY.RATE_LIMITS.GLOBAL.MAX_REQUESTS,
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/', globalLimiter);




app.use(express.static(path.join(__dirname, 'docs')));





app.use('/api/v1', apiRoutes);

app.use('/api', apiRoutes);


app.use('/', hlsRoutes);


app.use('/', addonRoutes);




app.get('/me', (req, res) => res.json(null));


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
