const { detectClient, isProxyStreamUrl } = require('../../src/utils/client-detection');

describe('client-detection', () => {
    it('detects web Stremio', () => {
        const info = detectClient('Stremio/Web 4.4', 'https://web.stremio.com');
        expect(info.client).toBe('web');
        expect(info.needsConstrainedPlayer).toBe(true);
    });

    it('detects Android TV', () => {
        const info = detectClient('Mozilla/5.0 (Linux; Android 11; AFTMM Build) ExoPlayer', '');
        expect(info.client).toBe('fire-tv');
        expect(info.needsConstrainedPlayer).toBe(true);
    });

    it('detects desktop', () => {
        const info = detectClient('Stremio/4.4.168 (Windows NT 10.0)', '');
        expect(info.client).toBe('desktop');
        expect(info.needsConstrainedPlayer).toBe(false);
    });

    it('identifies proxy stream URLs', () => {
        expect(isProxyStreamUrl('https://comet.example/playback/abc123/stream')).toBe(true);
        expect(isProxyStreamUrl('https://stremthru.example/proxy')).toBe(true);
        expect(isProxyStreamUrl('https://real-debrid.com/d/abc.mkv')).toBe(false);
    });
});
