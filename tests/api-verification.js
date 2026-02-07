const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const API_URL = process.env.PUBLIC_URL || 'http://localhost:7005';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/introhater';

async function runTests() {
    console.log('--- Starting API Security & Functionality Tests ---');

    let testApiKey = 'test_key_' + Math.random().toString(36).substring(7);
    let client;

    try {
        // 1. Setup: Inject a test API key into the DB
        client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db();
        const apiKeys = db.collection('apiKeys');

        await apiKeys.insertOne({
            key: testApiKey,
            name: 'Verification Test Key',
            userId: 'test_user_001',
            permissions: ['read:segments', 'write:segments', 'read:stats'],
            isActive: true,
            isAdminKey: false,
            createdAt: new Date()
        });
        console.log('✅ Test API key injected.');

        // 2. Test: Unauthorized Request
        try {
            await axios.get(`${API_URL}/api/v1/segments/tt1234567:1:1`);
            console.log('❌ UNEXPECTED: Unauthorized request succeeded.');
        } catch (e) {
            if (e.response?.status === 401) {
                console.log('✅ Unauthorized request correctly rejected (401).');
            } else {
                console.log('❌ Unexpected error for unauthorized request:', e.message);
            }
        }

        // 3. Test: Authorized GET Segments
        try {
            const res = await axios.get(`${API_URL}/api/v1/segments/tt1234567:1:1`, {
                headers: { 'x-api-key': testApiKey }
            });
            console.log('✅ Authorized GET segments succeeded.');
            if (Array.isArray(res.data)) console.log(`   Fetched ${res.data.length} segments.`);
        } catch (e) {
            console.log('❌ Authorized GET segments failed:', e.response?.data || e.message);
        }

        // 4. Test: Authorized POST Segment
        try {
            await axios.post(`${API_URL}/api/v1/segments`, {
                videoId: 'tt1234567:1:1',
                start: 10,
                end: 90,
                label: 'Intro'
            }, {
                headers: { 'x-api-key': testApiKey }
            });
            console.log('✅ Authorized POST segment succeeded.');
        } catch (e) {
            console.log('❌ Authorized POST segment failed:', e.response?.data || e.message);
        }

        // 5. Test: Rate Limiting (Briefly)
        console.log('--- Testing Rate Limiting (105 requests) ---');
        let reachedLimit = false;
        for (let i = 0; i < 105; i++) {
            try {
                await axios.get(`${API_URL}/api/v1/stats`, {
                    headers: { 'x-api-key': testApiKey }
                });
            } catch (e) {
                if (e.response?.status === 429) {
                    reachedLimit = true;
                    break;
                }
            }
        }
        if (reachedLimit) {
            console.log('✅ Rate limiting correctly triggered (429).');
        } else {
            console.log('❌ Rate limiting NOT triggered after 100 requests.');
        }

    } catch (e) {
        console.error('Test Execution Error:', e);
    } finally {
        if (client) {
            const apiKeys = client.db().collection('apiKeys');
            await apiKeys.deleteOne({ key: testApiKey });
            console.log('🧹 Test API key cleaned up.');
            await client.close();
        }
    }
}

// Check if server is running before starting tests
axios.get(`${API_URL}/ping`)
    .then(() => runTests())
    .catch(() => console.error(`❌ Server is not running at ${API_URL}. Please start the server before running tests.`));
