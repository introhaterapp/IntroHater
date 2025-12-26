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

// Sensitive field names to redact from logs (lowercase)
const SENSITIVE_FIELDS = ['password', 'token', 'apikey', 'rdkey', 'secret', 'authorization', 'cookie', 'key'];

class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'INFO';
    }

    _shouldLog(level) {
        const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
        return levels.indexOf(level) <= levels.indexOf(this.logLevel);
    }

    _sanitizeMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') return metadata;

        const sanitized = {};
        for (const [key, value] of Object.entries(metadata)) {
            const keyLower = key.toLowerCase();
            // Check if key matches sensitive field names (exact match or contains)
            const isSensitive = SENSITIVE_FIELDS.some(field => 
                keyLower === field || keyLower.includes(field)
            );
            
            if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                // Recursively sanitize nested objects
                sanitized[key] = this._sanitizeMetadata(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    _formatLog(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const sanitizedMetadata = this._sanitizeMetadata(metadata);
        
        const log = {
            timestamp,
            level,
            message,
            ...sanitizedMetadata
        };

        // In production, output JSON for log aggregation
        if (process.env.NODE_ENV === 'production') {
            return JSON.stringify(log);
        }

        // In development, output human-readable format
        const metaStr = Object.keys(sanitizedMetadata).length > 0 
            ? `\n  ${JSON.stringify(sanitizedMetadata, null, 2)}` 
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
