/**
 * Centralized structured logger using pino.
 * Replaces scattered console.log/error/warn calls with consistent, filterable logs.
 * 
 * Usage:
 *   const logger = require('../utils/logger');
 *   const log = logger.child({ component: 'SkipService' });
 *   log.info({ videoId }, 'Fetching segments');
 *   log.error({ err }, 'Failed to fetch');
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

// Base logger configuration
const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{component} {msg}'
        }
    } : undefined,
    base: undefined, // Remove pid and hostname in production too
    formatters: {
        level: (label) => ({ level: label })
    }
});

// Pre-configured child loggers for each component
module.exports = logger;
module.exports.default = logger;

// Named child loggers for common components
module.exports.ws = logger.child({ component: '[WS]' });
module.exports.hls = logger.child({ component: '[HLS]' });
module.exports.skip = logger.child({ component: '[SkipService]' });
module.exports.catalog = logger.child({ component: '[Catalog]' });
module.exports.users = logger.child({ component: '[Users]' });
module.exports.mongodb = logger.child({ component: '[MongoDB]' });
module.exports.indexer = logger.child({ component: '[Indexer]' });
module.exports.cache = logger.child({ component: '[CacheService]' });
module.exports.api = logger.child({ component: '[API]' });
module.exports.server = logger.child({ component: '[Server]' });
module.exports.apiKey = logger.child({ component: '[APIKey]' });
module.exports.metrics = logger.child({ component: '[Metrics]' });
