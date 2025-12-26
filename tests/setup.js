/**
 * Jest Test Setup
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '7006';
process.env.LOG_LEVEL = 'ERROR'; // Suppress logs during tests
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/introhater_test';

// Mock external APIs to avoid network calls during tests
jest.mock('axios', () => ({
    get: jest.fn(),
    post: jest.fn(),
    create: jest.fn(() => ({
        get: jest.fn(),
        post: jest.fn()
    }))
}));

// Global test timeout
jest.setTimeout(10000);
