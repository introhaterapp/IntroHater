const axios = require('axios');
const { isProxyStreamUrl } = require('./client-detection');

/**
 * Follow redirects on proxy URLs to get the underlying debrid direct link.
 */
async function resolveToDirectUrl(streamUrl) {
    if (!streamUrl || !isProxyStreamUrl(streamUrl)) {
        return streamUrl;
    }

    try {
        const resolveRes = await axios.get(streamUrl, {
            maxRedirects: 5,
            timeout: 15000,
            headers: { 'User-Agent': 'Stremio/4.4', 'Range': 'bytes=0-0' },
            responseType: 'stream',
            validateStatus: (status) => status >= 200 && status < 400
        });

        const finalUrl = resolveRes.request?.res?.responseUrl || resolveRes.config?.url || streamUrl;
        if (resolveRes.data && typeof resolveRes.data.destroy === 'function') {
            resolveRes.data.destroy();
        }
        return finalUrl;
    } catch {
        return streamUrl;
    }
}

module.exports = {
    resolveToDirectUrl
};
