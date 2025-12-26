/**
 * Unit Tests for Input Validation Middleware
 */

const { isSecureUrl } = require('../../src/middleware/validation');

describe('Input Validation', () => {
    describe('isSecureUrl', () => {
        it('should accept valid HTTPS URLs', () => {
            expect(isSecureUrl('https://example.com')).toBe(true);
            expect(isSecureUrl('https://api.example.com/path')).toBe(true);
        });

        it('should accept valid HTTP URLs', () => {
            expect(isSecureUrl('http://example.com')).toBe(true);
        });

        it('should reject localhost', () => {
            expect(isSecureUrl('http://localhost')).toBe(false);
            expect(isSecureUrl('http://127.0.0.1')).toBe(false);
            expect(isSecureUrl('http://0.0.0.0')).toBe(false);
        });

        it('should reject private IP ranges', () => {
            expect(isSecureUrl('http://10.0.0.1')).toBe(false);
            expect(isSecureUrl('http://192.168.1.1')).toBe(false);
            expect(isSecureUrl('http://172.16.0.1')).toBe(false);
            expect(isSecureUrl('http://172.31.255.255')).toBe(false);
        });

        it('should reject metadata services', () => {
            expect(isSecureUrl('http://169.254.169.254')).toBe(false);
            expect(isSecureUrl('http://metadata.google.internal')).toBe(false);
        });

        it('should reject non-HTTP protocols', () => {
            expect(isSecureUrl('file:///etc/passwd')).toBe(false);
            expect(isSecureUrl('ftp://example.com')).toBe(false);
            expect(isSecureUrl('javascript:alert(1)')).toBe(false);
        });

        it('should reject invalid URLs', () => {
            expect(isSecureUrl('not a url')).toBe(false);
            expect(isSecureUrl('')).toBe(false);
            expect(isSecureUrl(null)).toBe(false);
        });
    });
});
