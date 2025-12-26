/**
 * Centralized Error Handling Middleware
 * Provides consistent error responses and logging
 */

const logger = require('../utils/logger');

class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Global error handler
function errorHandler(err, req, res, next) {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log error
    if (err.statusCode >= 500) {
        logger.error('Server Error', {
            error: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method,
            ip: req.ip
        });
    } else {
        logger.warn('Client Error', {
            error: err.message,
            path: req.path,
            method: req.method,
            statusCode: err.statusCode
        });
    }

    // Send error response
    res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

// Async handler wrapper to catch promise rejections
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// 404 handler
function notFoundHandler(req, res, next) {
    const err = new AppError(`Route not found: ${req.originalUrl}`, 404);
    next(err);
}

module.exports = {
    AppError,
    errorHandler,
    asyncHandler,
    notFoundHandler
};
