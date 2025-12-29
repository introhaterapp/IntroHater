


class ApiError extends Error {
    
    constructor(statusCode, message, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}


const errorHandler = (err, req, res, _next) => {
    
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational !== undefined ? err.isOperational : false;

    
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ERROR] ${req.method} ${req.originalUrl} - ${err.message}`;

    if (isOperational) {
        console.warn(logMessage);
    } else {
        console.error(logMessage);
        console.error(err.stack);
    }

    
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};


const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};


const setupGlobalErrorHandlers = () => {
    process.on('unhandledRejection', (reason) => {
        console.error(`[${new Date().toISOString()}] [UNHANDLED REJECTION]`, reason);
        
    });

    process.on('uncaughtException', (error) => {
        console.error(`[${new Date().toISOString()}] [UNCAUGHT EXCEPTION]`, error);
        
        
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
