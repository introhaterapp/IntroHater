/**
 * Global Error Handling Middleware
 * Centralizes error handling to prevent server crashes and ensure consistent error responses.
 * @module middleware/errorHandler
 */

/**
 * Custom API Error class for throwing structured errors
 */
class ApiError extends Error {
    /**
     * @param {number} statusCode - HTTP status code
     * @param {string} message - Error message
     * @param {boolean} [isOperational=true] - Whether this is an operational (expected) error
     */
    constructor(statusCode, message, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Express error handling middleware
 * Must be registered AFTER all routes: app.use(errorHandler)
 * @param {Error} err - The error object
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next function
 */
const errorHandler = (err, req, res, _next) => {
    // Default to 500 if no status code set
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational !== undefined ? err.isOperational : false;

    // Log error details
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ERROR] ${req.method} ${req.originalUrl} - ${err.message}`;

    if (isOperational) {
        console.warn(logMessage);
    } else {
        console.error(logMessage);
        console.error(err.stack);
    }

    // Send error response
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

/**
 * Async route wrapper to catch errors in async handlers
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler that catches errors
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Setup global process error handlers
 * Call this once during server initialization
 */
const setupGlobalErrorHandlers = () => {
    process.on('unhandledRejection', (reason) => {
        console.error(`[${new Date().toISOString()}] [UNHANDLED REJECTION]`, reason);
        // Don't exit - let the app continue running
    });

    process.on('uncaughtException', (error) => {
        console.error(`[${new Date().toISOString()}] [UNCAUGHT EXCEPTION]`, error);
        // For uncaught exceptions, we should exit gracefully
        // But in production with process managers like PM2, they will restart
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    });
};

module.exports = {
    ApiError,
    errorHandler,
    asyncHandler,
    setupGlobalErrorHandlers
};
