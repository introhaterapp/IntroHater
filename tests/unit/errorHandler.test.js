/**
 * Unit Tests for Error Handling Middleware
 */

const { AppError, asyncHandler, errorHandler } = require('../../src/middleware/errorHandler');

describe('Error Handling Middleware', () => {
    describe('AppError', () => {
        it('should create an operational error', () => {
            const error = new AppError('Test error', 400);
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(400);
            expect(error.isOperational).toBe(true);
        });

        it('should create a non-operational error', () => {
            const error = new AppError('Test error', 500, false);
            expect(error.isOperational).toBe(false);
        });
    });

    describe('asyncHandler', () => {
        it('should handle successful async operations', async () => {
            const handler = asyncHandler(async (req, res) => {
                res.json({ success: true });
            });

            const req = {};
            const res = {
                json: jest.fn()
            };
            const next = jest.fn();

            await handler(req, res, next);

            expect(res.json).toHaveBeenCalledWith({ success: true });
            expect(next).not.toHaveBeenCalled();
        });

        it('should catch and pass errors to next', async () => {
            const testError = new Error('Test error');
            const handler = asyncHandler(async () => {
                throw testError;
            });

            const req = {};
            const res = {};
            const next = jest.fn();

            await handler(req, res, next);

            expect(next).toHaveBeenCalledWith(testError);
        });
    });

    describe('errorHandler', () => {
        it('should handle AppError correctly', () => {
            const error = new AppError('Not found', 404);
            const req = { path: '/test', method: 'GET', ip: '127.0.0.1' };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'error',
                    message: 'Not found'
                })
            );
        });

        it('should default to 500 for unknown errors', () => {
            const error = new Error('Unknown error');
            const req = { path: '/test', method: 'GET', ip: '127.0.0.1' };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
