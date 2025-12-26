/**
 * Standardized API Response Helpers
 * Ensures consistent response format: { success: boolean, data?: any, error?: string, meta?: any }
 * @module utils/apiResponse
 */

/**
 * Send a success response
 * @param {import('express').Response} res - Express response object
 * @param {any} data - Response data
 * @param {Object} [meta] - Optional metadata (pagination, timestamps, etc.)
 * @param {number} [statusCode=200] - HTTP status code
 */
const successResponse = (res, data, meta = null, statusCode = 200) => {
    const response = {
        success: true,
        data
    };

    if (meta) {
        response.meta = meta;
    }

    return res.status(statusCode).json(response);
};

/**
 * Send an error response
 * @param {import('express').Response} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} [details] - Optional error details
 */
const errorResponse = (res, statusCode, message, details = null) => {
    const response = {
        success: false,
        error: message
    };

    if (details) {
        response.details = details;
    }

    return res.status(statusCode).json(response);
};

/**
 * Send a paginated response
 * @param {import('express').Response} res - Express response object
 * @param {Array} data - Array of items
 * @param {Object} pagination - Pagination info { page, limit, total }
 */
const paginatedResponse = (res, data, pagination) => {
    return successResponse(res, data, {
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: pagination.total,
            totalPages: Math.ceil(pagination.total / pagination.limit)
        }
    });
};

module.exports = {
    successResponse,
    errorResponse,
    paginatedResponse
};
