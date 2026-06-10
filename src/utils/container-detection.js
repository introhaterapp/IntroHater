/**
 * Detect video container from URL for byte-range HLS compatibility.
 */

function detectContainer(url) {
    if (!url) return 'unknown';
    const lower = url.toLowerCase().split('?')[0];
    if (lower.includes('.mkv') || lower.includes('matroska')) return 'mkv';
    if (lower.includes('.mp4') || lower.includes('.m4v')) return 'mp4';
    return 'unknown';
}

function canByteRangeSkipOnClient(container, clientInfo) {
    if (container === 'mp4' || container === 'unknown') return true;
    if (container === 'mkv' && clientInfo && !clientInfo.needsConstrainedPlayer) return true;
    return false;
}

module.exports = {
    detectContainer,
    canByteRangeSkipOnClient
};
