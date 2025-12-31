const hlsProxy = require('../../src/services/hls-proxy');
const axios = require('axios');
const child_process = require('child_process');
const { EventEmitter } = require('events');

jest.mock('axios');
jest.mock('child_process');

describe('HLS Proxy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('generateSmartManifest', () => {
        it('should generate a valid spliced m3u8 playlist with discontinuity', () => {
            const m3u8 = hlsProxy.generateSmartManifest('http://video.mp4', 3600, 1000, 5000);

            expect(m3u8).toContain('#EXT-X-TARGETDURATION:3600');
            expect(m3u8).toContain('#EXT-X-BYTERANGE:5000000@0');
            expect(m3u8).toContain('#EXT-X-DISCONTINUITY');
            expect(m3u8).toContain('#EXT-X-BYTERANGE:4000@1000');
            expect(m3u8).toContain('http://video.mp4');
        });
    });

    describe('getStreamDetails (Mocked Axios)', () => {
        it('should return final URL and content length on success', async () => {
            axios.head.mockResolvedValue({
                request: { res: { responseUrl: 'http://final.mp4' } },
                headers: { 'content-length': '123456' }
            });

            const details = await hlsProxy.getStreamDetails('http://orig.mp4');
            expect(details).toEqual({ finalUrl: 'http://final.mp4', contentLength: 123456 });
        });

        it('should gracefully handle 404s/network errors', async () => {
            axios.head.mockRejectedValue(new Error('Network Error'));

            const details = await hlsProxy.getStreamDetails('http://orig.mp4');

            expect(details).toEqual({ finalUrl: 'http://orig.mp4', contentLength: null });
        });
    });

    describe('getChapters (Mocked FFprobe)', () => {
        it('should return chapters list on success', async () => {
            const mockProc = new EventEmitter();
            mockProc.stdout = new EventEmitter();
            mockProc.stderr = new EventEmitter();
            child_process.spawn.mockReturnValue(mockProc);

            const promise = hlsProxy.getChapters('http://vid.mp4');


            const mockOutput = JSON.stringify({
                chapters: [
                    { start_time: "0.0", end_time: "90.0", tags: { title: "Intro" } },
                    { start_time: "90.0", end_time: "1200.0", tags: { title: "Episode" } }
                ]
            });

            setTimeout(() => {
                mockProc.stdout.emit('data', mockOutput);
                mockProc.emit('close', 0);
            }, 10);

            const result = await promise;
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ startTime: 0, endTime: 90, title: "Intro" });
        });

        it('should return empty list if ffprobe errors', async () => {
            const mockProc = new EventEmitter();
            mockProc.stdout = new EventEmitter();
            mockProc.stderr = new EventEmitter();
            child_process.spawn.mockReturnValue(mockProc);

            const promise = hlsProxy.getChapters('http://vid.mp4');

            setTimeout(() => {
                mockProc.emit('close', 1);
            }, 10);

            const result = await promise;
            expect(result).toEqual([]);
        });
    });
});
