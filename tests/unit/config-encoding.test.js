const { encodeConfigParam, decodeConfigParam, normalizeScraperUrl } = require('../../src/utils/config-encoding');

describe('config-encoding', () => {
    it('roundtrips base64url', () => {
        const url = 'https://aiostreams.example/stremio/abc123/manifest.json';
        const encoded = encodeConfigParam(url);
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('+');
        expect(decodeConfigParam(encoded)).toBe(url);
    });

    it('decodes legacy base64', () => {
        const legacy = Buffer.from('https://test.example/foo').toString('base64');
        expect(decodeConfigParam(legacy)).toBe('https://test.example/foo');
    });

    it('normalizes scraper URL', () => {
        expect(normalizeScraperUrl('stremio://host/path/manifest.json'))
            .toBe('https://host/path');
    });
});
