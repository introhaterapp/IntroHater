/**
 * Detect Stremio client platform from User-Agent and Origin headers.
 */

function detectClient(userAgent = '', origin = '') {
    const ua = (userAgent || '').toLowerCase();
    const orig = (origin || '').toLowerCase();

    const isWebStremio = ua.includes('stremio/web') || orig.includes('strem.io') || orig.includes('stremio.com');
    const isFireTv = ua.includes('aftm') || ua.includes('aftb') || ua.includes('aftt') || ua.includes('fire tv') || ua.includes('silk/');
    const isTizen = ua.includes('tizen');
    const isWebOs = ua.includes('webos') || ua.includes('web0s');
    const isAndroid = ua.includes('android') || ua.includes('exoplayer') || ua.includes('shield') || ua.includes('google tv') || ua.includes('bravia');
    const isAndroidTv = isAndroid && (ua.includes('android tv') || ua.includes('aft') || ua.includes('google tv') || ua.includes('bravia') || ua.includes('shield'));
    const isIos = ua.includes('iphone') || ua.includes('ipad') || (ua.includes('ios') && !ua.includes('stremio'));

    let client = 'desktop';
    if (isWebStremio) client = 'web';
    else if (isFireTv) client = 'fire-tv';
    else if (isTizen) client = 'tizen';
    else if (isWebOs) client = 'webos';
    else if (isAndroidTv) client = 'android-tv';
    else if (isAndroid) client = 'android';
    else if (isIos) client = 'ios';

    const needsConstrainedPlayer = isWebStremio || isAndroid || isFireTv || isTizen || isWebOs;
    const canUseByteRangeHls = !needsConstrainedPlayer || isIos;
    const isDesktop = client === 'desktop';
    const isTvMobile = needsConstrainedPlayer;

    return {
        client,
        needsConstrainedPlayer,
        canUseByteRangeHls,
        isDesktop,
        isTvMobile,
        isWebStremio,
        isAndroid,
        isIos
    };
}

function isProxyStreamUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return url.includes('/playback/') ||
        lower.includes('stremthru') ||
        lower.includes('mediafusion') ||
        lower.includes('aiostreams');
}

function buildHlsManifestUrl(baseUrl, params) {
    const {
        streamUrl,
        infoHash,
        id,
        userKeyPrefix,
        provider,
        rdKey,
        skipStart,
        skipEnd,
        client,
        preferMp4
    } = params;

    const parts = [`${baseUrl}/hls/manifest.m3u8`];
    const query = [];

    if (infoHash) {
        query.push(`infoHash=${infoHash}`);
    } else if (streamUrl) {
        query.push(`stream=${encodeURIComponent(streamUrl)}`);
    }

    if (id) query.push(`id=${id}`);
    if (userKeyPrefix) query.push(`user=${userKeyPrefix}`);
    if (provider) query.push(`provider=${provider}`);
    if (rdKey) query.push(`rdKey=${rdKey}`);
    if (skipStart != null && skipEnd != null) {
        query.push(`start=${skipStart}`, `end=${skipEnd}`);
    }
    if (client) query.push(`client=${client}`);
    if (preferMp4) query.push('preferMp4=true');

    return parts[0] + '?' + query.join('&');
}

module.exports = {
    detectClient,
    isProxyStreamUrl,
    buildHlsManifestUrl
};
