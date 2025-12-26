/**
 * Unit Tests for Logger
 */

describe('Logger', () => {
    let consoleLogSpy, consoleErrorSpy, consoleWarnSpy;
    let Logger;
    let originalLogLevel;

    beforeEach(() => {
        // Save and set log level to DEBUG for testing
        originalLogLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'DEBUG';
        
        // Clear module cache to get fresh instance
        jest.resetModules();
        
        // Create real console spies before importing logger
        consoleLogSpy = jest.spyOn(console, 'log');
        consoleErrorSpy = jest.spyOn(console, 'error');
        consoleWarnSpy = jest.spyOn(console, 'warn');
        
        // Now require logger
        Logger = require('../../src/utils/logger');
    });

    afterEach(() => {
        // Restore log level
        process.env.LOG_LEVEL = originalLogLevel;
        
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('should log error messages', () => {
        Logger.error('Test error', { code: 500 });
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should log warning messages', () => {
        Logger.warn('Test warning', { code: 400 });
        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should log info messages', () => {
        Logger.info('Test info', { userId: '123' });
        expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should include metadata in logs', () => {
        Logger.info('Test', { key: 'value' });
        expect(consoleLogSpy).toHaveBeenCalled();
        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(logOutput).toContain('Test');
        expect(logOutput).toContain('key');
    });

    it('should format timestamps in ISO format', () => {
        Logger.info('Test');
        expect(consoleLogSpy).toHaveBeenCalled();
        const logOutput = consoleLogSpy.mock.calls[0][0];
        // Check for ISO timestamp pattern
        expect(logOutput).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
});
