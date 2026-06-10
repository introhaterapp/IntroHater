/**
 * URL-safe base64 encoding for Stremio addon config params (s=, p=, pp=).
 */

function encodeConfigParam(value) {
    if (!value) return '';
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodeConfigParam(encoded) {
    if (!encoded) return '';
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    return Buffer.from(b64, 'base64').toString('utf8');
}

function normalizeScraperUrl(url) {
    if (!url) return null;
    let clean = url.trim();
    if (clean.startsWith('stremio://')) {
        clean = clean.replace('stremio://', 'https://');
    }
    if (clean.startsWith('http://')) {
        clean = clean.replace('http://', 'https://');
    }
    clean = clean.replace(/\/$/, '');
    if (clean.endsWith('/manifest.json')) {
        clean = clean.replace(/\/manifest\.json$/, '');
    }
    return clean;
}

module.exports = {
    encodeConfigParam,
    decodeConfigParam,
    normalizeScraperUrl
};
