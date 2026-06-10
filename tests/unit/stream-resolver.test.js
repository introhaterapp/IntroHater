jest.mock('axios');
const axios = require('axios');
const { resolveToDirectUrl } = require('../../src/utils/stream-resolver');

describe('stream-resolver', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns direct URLs unchanged', async () => {
        const url = 'https://real-debrid.com/d/file.mkv';
        expect(await resolveToDirectUrl(url)).toBe(url);
    });

    it('follows redirects on proxy URLs', async () => {
        const proxy = 'https://comet.example/playback/abc/stream';
        const destroy = jest.fn();
        axios.get.mockResolvedValue({
            request: { res: { responseUrl: 'https://real-debrid.com/d/file.mkv' } },
            config: { url: proxy },
            data: { destroy }
        });

        const result = await resolveToDirectUrl(proxy);
        expect(result).toBe('https://real-debrid.com/d/file.mkv');
        expect(destroy).toHaveBeenCalled();
    });
});
