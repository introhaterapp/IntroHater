


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
