const {
    evaluateManifestResponse,
    evaluateIntroDbResponse,
    classifyServiceError,
    checkServiceEndpoint
} = require('../../src/services/scraper-health');

describe('scraper-health', () => {
    describe('evaluateManifestResponse', () => {
        it('returns online for a valid Stremio manifest', () => {
            expect(evaluateManifestResponse({ id: 'com.example', name: 'Example' })).toEqual({
                status: 'online',
                detail: null
            });
        });

        it('returns degraded when manifest fields are missing', () => {
            expect(evaluateManifestResponse({ version: '1.0.0' })).toEqual({
                status: 'degraded',
                detail: 'Unexpected response format'
            });
        });
    });

    describe('evaluateIntroDbResponse', () => {
        it('returns online for JSON object responses', () => {
            expect(evaluateIntroDbResponse({ intro: [] })).toEqual({
                status: 'online',
                detail: null
            });
        });
    });

    describe('classifyServiceError', () => {
        it('maps CDN blocks to unreachable instead of implying addon failure', () => {
            expect(classifyServiceError({ response: { status: 403 } })).toEqual({
                status: 'unreachable',
                detail: 'CDN blocked from server (likely fine for users)'
            });
        });

        it('maps axios timeouts to timeout status', () => {
            expect(classifyServiceError({ code: 'ECONNABORTED', message: 'timeout of 12000ms exceeded' })).toEqual({
                status: 'timeout',
                detail: 'Request timed out from server'
            });
        });

        it('maps server errors to degraded', () => {
            expect(classifyServiceError({ response: { status: 503 }, message: 'Service Unavailable' })).toEqual({
                status: 'degraded',
                detail: 'HTTP 503'
            });
        });
    });

    describe('checkServiceEndpoint', () => {
        it('validates manifest responses instead of stream payloads', async () => {
            const axiosGet = jest.fn().mockResolvedValue({
                status: 200,
                data: { id: 'community.torrentio', name: 'Torrentio' }
            });

            const result = await checkServiceEndpoint(axiosGet, {
                url: 'https://torrentio.strem.fun/manifest.json',
                timeout: 8000
            });

            expect(result.status).toBe('online');
            expect(axiosGet).toHaveBeenCalledWith(
                'https://torrentio.strem.fun/manifest.json',
                expect.objectContaining({
                    timeout: 8000,
                    headers: expect.objectContaining({ 'User-Agent': 'Stremio/4.4' })
                })
            );
        });

        it('classifies HTTP 403 responses as unreachable', async () => {
            const axiosGet = jest.fn().mockResolvedValue({
                status: 403,
                data: 'blocked'
            });

            const result = await checkServiceEndpoint(axiosGet, {
                url: 'https://torrentio.strem.fun/manifest.json',
                timeout: 8000
            });

            expect(result.status).toBe('unreachable');
        });
    });
});
