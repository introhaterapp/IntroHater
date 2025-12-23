const axios = require('axios');

async function testFallback() {
    const baseUrl = 'http://127.0.0.1:7005';
    const streamUrl = encodeURIComponent('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
    const testUrl = `${baseUrl}/hls/manifest.m3u8?stream=${streamUrl}&start=0&end=0&id=test&user=testuser&rdKey=testkey`;

    console.log(`Testing HLS Fallback: ${testUrl}`);

    try {
        // 1. First request - should trigger probing but return manifest
        console.log('--- Request 1 ---');
        const start = Date.now();
        const res1 = await axios.get(testUrl, { maxRedirects: 0 });
        console.log(`Status: ${res1.status}`);
        console.log(`Time: ${Date.now() - start}ms`);
        console.log(`Content-Type: ${res1.headers['content-type']}`);

        if (res1.data.includes('#EXTM3U')) {
            console.log('SUCCESS: Received M3U8 manifest.');
        } else {
            console.log('FAILED: No manifest found.');
            process.exit(1);
        }

        // 2. Second request - should be instant (cached)
        console.log('\n--- Request 2 (Cached) ---');
        const start2 = Date.now();
        const res2 = await axios.get(testUrl, { maxRedirects: 0 });
        const time2 = Date.now() - start2;
        console.log(`Status: ${res2.status}`);
        console.log(`Time: ${time2}ms`);

        if (time2 < 100) {
            console.log('SUCCESS: Content served from cache.');
        } else {
            console.log('WARNING: Cache might not be working or server is slow.');
        }

    } catch (e) {
        if (e.response && e.response.status === 302) {
            console.log('FAILED: Still redirecting (received 302).');
        } else {
            console.error('ERROR during test:', e.message);
        }
        process.exit(1);
    }
}

testFallback();
