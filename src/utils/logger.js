/**
 * Structured Logging Utility
 * Provides consistent logging across the application
 */

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'INFO';
    }

    _shouldLog(level) {
        const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
        return levels.indexOf(level) <= levels.indexOf(this.logLevel);
    }

    _formatLog(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const log = {
            timestamp,
            level,
            message,
            ...metadata
        };

        // In production, output JSON for log aggregation
        if (process.env.NODE_ENV === 'production') {
            return JSON.stringify(log);
        }

        // In development, output human-readable format
        const metaStr = Object.keys(metadata).length > 0 
            ? `\n  ${JSON.stringify(metadata, null, 2)}` 
            : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    }

    error(message, metadata = {}) {
        if (this._shouldLog('ERROR')) {
            console.error(this._formatLog('ERROR', message, metadata));
        }
    }

    warn(message, metadata = {}) {
        if (this._shouldLog('WARN')) {
            console.warn(this._formatLog('WARN', message, metadata));
        }
    }

    info(message, metadata = {}) {
        if (this._shouldLog('INFO')) {
            console.log(this._formatLog('INFO', message, metadata));
        }
    }

    debug(message, metadata = {}) {
        if (this._shouldLog('DEBUG')) {
            console.log(this._formatLog('DEBUG', message, metadata));
        }
    }
}

module.exports = new Logger();
