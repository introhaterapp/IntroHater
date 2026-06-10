const { detectContainer, canByteRangeSkipOnClient } = require('../../src/utils/container-detection');

describe('container-detection', () => {
    it('detects mkv and mp4', () => {
        expect(detectContainer('https://cdn.example/video.mkv')).toBe('mkv');
        expect(detectContainer('https://cdn.example/video.mp4')).toBe('mp4');
        expect(detectContainer('https://cdn.example/stream')).toBe('unknown');
    });

    it('blocks mkv on constrained clients', () => {
        expect(canByteRangeSkipOnClient('mkv', { needsConstrainedPlayer: true })).toBe(false);
        expect(canByteRangeSkipOnClient('mkv', { needsConstrainedPlayer: false })).toBe(true);
        expect(canByteRangeSkipOnClient('mp4', { needsConstrainedPlayer: true })).toBe(true);
    });
});
