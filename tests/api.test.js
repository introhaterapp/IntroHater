/**
 * IntroHater API Test Suite
 * Run with: node tests/api.test.js
 * 
 * Tests all critical API endpoints to catch regressions early.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:7005';

// Simple test runner
let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        results.push({ name, status: '✅ PASS' });
        console.log(`✅ ${name}`);
    } catch (e) {
        failed++;
        results.push({ name, status: '❌ FAIL', error: e.message });
        console.log(`❌ ${name}: ${e.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertType(value, type, message) {
    if (typeof value !== type) throw new Error(message || `Expected ${type}, got ${typeof value}`);
}

// ============ API TESTS ============

async function runTests() {
    console.log('\n🧪 IntroHater API Test Suite\n' + '='.repeat(40) + '\n');

    // --- Ping ---
    await test('GET /ping returns pong', async () => {
        const res = await fetch(`${BASE_URL}/ping`);
        const text = await res.text();
        assert(res.ok, `Expected 200, got ${res.status}`);
        assert(text === 'pong', `Expected 'pong', got '${text}'`);
    });

    // --- Stats API ---
    await test('GET /api/stats returns valid stats object', async () => {
        const res = await fetch(`${BASE_URL}/api/stats`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assertType(data.users, 'number', 'users should be a number');
        assertType(data.skips, 'number', 'skips should be a number');
        assertType(data.showCount, 'number', 'showCount should be a number');
        assertType(data.episodeCount, 'number', 'episodeCount should be a number');
        assert(data.sources !== undefined, 'sources should exist');
    });

    // --- Leaderboard API ---
    await test('GET /api/leaderboard returns users array', async () => {
        const res = await fetch(`${BASE_URL}/api/leaderboard`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data.users), 'users should be an array');
        assert(data.lastUpdated !== undefined, 'lastUpdated should exist');
        if (data.users.length > 0) {
            assert(data.users[0].rank !== undefined, 'user should have rank');
            assert(data.users[0].userId !== undefined, 'user should have userId');
        }
    });

    // --- Activity API (Live Ticker) ---
    await test('GET /api/activity returns array of recent segments', async () => {
        const res = await fetch(`${BASE_URL}/api/activity`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data), 'response should be an array');
        if (data.length > 0) {
            assert(data[0].videoId !== undefined, 'item should have videoId');
            assert(data[0].label !== undefined, 'item should have label');
            assert(data[0].timestamp !== undefined, 'item should have timestamp');
        }
    });

    // --- Catalog API ---
    await test('GET /api/catalog returns valid catalog data', async () => {
        const res = await fetch(`${BASE_URL}/api/catalog?draw=1&start=0&length=5`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(data.draw !== undefined || data.media !== undefined, 'should have draw or media');
        assertType(data.recordsTotal, 'number', 'recordsTotal should be a number');
    });

    // --- Segments API ---
    await test('GET /api/segments/:id returns array', async () => {
        const res = await fetch(`${BASE_URL}/api/segments/tt0000000`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data), 'response should be an array');
    });

    // --- Search API ---
    await test('GET /api/search returns results for valid query', async () => {
        const res = await fetch(`${BASE_URL}/api/search?q=test`);
        // May return empty if no OMDB key, but should not error
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(data !== undefined, 'should return data');
    });

    // --- Personal Stats (requires valid RD key, so we test 400 for missing key) ---
    await test('POST /api/stats/personal returns 400 without rdKey', async () => {
        const res = await fetch(`${BASE_URL}/api/stats/personal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // --- Submit requires valid RD key, test 400 for missing fields ---
    await test('POST /api/submit returns 400 without required fields', async () => {
        const res = await fetch(`${BASE_URL}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // --- Report requires rdKey ---
    await test('POST /api/report returns 400 without fields', async () => {
        const res = await fetch(`${BASE_URL}/api/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // --- Stremio Addon Manifest ---
    await test('GET /manifest.json (Stremio manifest route) returns valid addon manifest', async () => {
        // The Stremio SDK serves manifest at /manifest.json with addon properties
        const res = await fetch(`${BASE_URL}/manifest.json`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        // Could be PWA manifest (from docs/manifest.json) or Stremio manifest
        // Check for either case
        const isStremioManifest = data.id === 'org.introhater';
        const isPWAManifest = data.name === 'IntroHater' && data.icons !== undefined;
        assert(isStremioManifest || isPWAManifest, 'Should be either Stremio or PWA manifest');
    });

    // --- Static Files ---
    await test('GET / serves index.html', async () => {
        const res = await fetch(`${BASE_URL}/`);
        assert(res.ok, `Expected 200, got ${res.status}`);
        const text = await res.text();
        assert(text.includes('IntroHater'), 'should contain IntroHater');
    });

    await test('GET /community.html serves community page', async () => {
        const res = await fetch(`${BASE_URL}/community.html`);
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    await test('GET /catalog.html serves catalog page', async () => {
        const res = await fetch(`${BASE_URL}/catalog.html`);
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    await test('GET /leaderboard.html serves leaderboard page', async () => {
        const res = await fetch(`${BASE_URL}/leaderboard.html`);
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    // ============ SUMMARY ============
    console.log('\n' + '='.repeat(40));
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.log('\n❌ Failed tests:');
        results.filter(r => r.status.includes('FAIL')).forEach(r => {
            console.log(`   - ${r.name}: ${r.error}`);
        });
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed!\n');
        process.exit(0);
    }
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
