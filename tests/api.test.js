const request = require('supertest');
const app = require('../server');
const BASE_URL = process.env.TEST_URL;


let passed = 0;
let failed = 0;
const results = [];

async function getResponse(method, path, body = null) {
    if (BASE_URL) {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`${BASE_URL}${path}`, options);
        return {
            ok: res.ok,
            status: res.status,
            json: () => res.json(),
            text: () => res.text()
        };
    } else {
        const req = request(app)[method.toLowerCase()](path);
        if (body) req.send(body);
        const res = await req;
        return {
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            json: () => Promise.resolve(res.body),
            text: () => Promise.resolve(res.text)
        };
    }
}

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



async function runTests() {
    console.log('\n🧪 IntroHater API Test Suite\n' + '='.repeat(40) + '\n');

    
    await test('GET /ping returns pong', async () => {
        const res = await getResponse('GET', '/ping');
        const text = await res.text();
        assert(res.ok, `Expected 200, got ${res.status}`);
        assert(text === 'pong', `Expected 'pong', got '${text}'`);
    });

    
    await test('GET /api/stats returns valid stats object', async () => {
        const res = await getResponse('GET', '/api/stats');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assertType(data.users, 'number', 'users should be a number');
        assertType(data.skips, 'number', 'skips should be a number');
        assertType(data.showCount, 'number', 'showCount should be a number');
        assertType(data.episodeCount, 'number', 'episodeCount should be a number');
        assert(data.sources !== undefined, 'sources should exist');
    });

    
    await test('GET /api/leaderboard returns users array', async () => {
        const res = await getResponse('GET', '/api/leaderboard');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data.users), 'users should be an array');
        assert(data.lastUpdated !== undefined, 'lastUpdated should exist');
        if (data && data.users && data.users.length > 0) {
            assert(data.users[0].rank !== undefined, 'user should have rank');
            assert(data.users[0].userId !== undefined, 'user should have userId');
        }
    });

    
    await test('GET /api/activity returns array of recent segments with titles', async () => {
        const res = await getResponse('GET', '/api/activity');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data), 'response should be an array');
        if (data && data.length > 0) {
            assert(data[0].videoId !== undefined, 'item should have videoId');
            assert(data[0].title !== undefined, 'item should have title');
            assert(data[0].label !== undefined, 'item should have label');
            assert(data[0].timestamp !== undefined, 'item should have timestamp');
        }
    });

    
    await test('GET /api/catalog returns valid catalog data', async () => {
        const res = await getResponse('GET', '/api/catalog?draw=1&start=0&length=5');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(data.draw !== undefined || data.media !== undefined, 'should have draw or media');
        assertType(data.recordsTotal, 'number', 'recordsTotal should be a number');
    });

    
    await test('GET /api/segments/:id returns array', async () => {
        const res = await getResponse('GET', '/api/segments/tt0000000');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(Array.isArray(data), 'response should be an array');
    });

    
    await test('GET /api/search returns results for valid query', async () => {
        const res = await getResponse('GET', '/api/search?q=test');
        
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert(data !== undefined, 'should return data');
    });

    
    await test('POST /api/stats/personal returns 400 without rdKey', async () => {
        const res = await getResponse('POST', '/api/stats/personal', {});
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    
    await test('POST /api/submit returns 400 without required fields', async () => {
        const res = await getResponse('POST', '/api/submit', {});
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    
    await test('POST /api/report returns 400 without fields', async () => {
        const res = await getResponse('POST', '/api/report', {});
        assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    
    await test('GET /manifest.json (Stremio manifest route) returns valid addon manifest', async () => {
        const res = await getResponse('GET', '/manifest.json');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const data = await res.json();
        const isStremioManifest = data && data.id === 'org.introhater';
        const isPWAManifest = data && data.name === 'IntroHater' && data.icons !== undefined;
        assert(isStremioManifest || isPWAManifest, 'Should be either Stremio or PWA manifest');
    });

    
    await test('GET / serves index.html', async () => {
        const res = await getResponse('GET', '/');
        assert(res.ok, `Expected 200, got ${res.status}`);
        const text = await res.text();
        assert(text && text.includes('IntroHater'), 'should contain IntroHater');
    });

    await test('GET /contribute.html serves contribute page', async () => {
        const res = await getResponse('GET', '/contribute.html');
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    await test('GET /catalog.html serves catalog page', async () => {
        const res = await getResponse('GET', '/catalog.html');
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    await test('GET /leaderboard.html serves leaderboard page', async () => {
        const res = await getResponse('GET', '/leaderboard.html');
        assert(res.ok, `Expected 200, got ${res.status}`);
    });

    
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
