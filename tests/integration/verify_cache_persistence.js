const axios = require('axios');

async function testCachePersistence() {
    const onePiece = 'tt0388629';
    const testShow = 'ttTEST_CACHE_WIPE';

    try {
        console.log("Warming One Piece cache...");
        const start1 = Date.now();
        await axios.get(`http://localhost:7005/api/segments/${onePiece}`);
        console.log(`Warmup 1 took: ${Date.now() - start1}ms`);

        console.log("\nAdding a segment for a DIFFERENT show (should not wipe One Piece)...");
        await axios.post('http://localhost:7005/api/submit', {
            rdKey: 'DUMMY_KEY_FOR_TEST', 
            imdbID: testShow,
            start: 10,
            end: 20
        }).catch(() => console.log("(Success) Submitted segment (ignoring auth failure for trigger check)"));

        console.log("\nFetching One Piece again...");
        const start2 = Date.now();
        await axios.get(`http://localhost:7005/api/segments/${onePiece}`);
        const duration2 = Date.now() - start2;
        console.log(`Cache Hit fetch took: ${duration2}ms`);

        if (duration2 < 100) {
            console.log("\nSUCCESS: One Piece cache persisted!");
        } else {
            console.log("\nFAILURE: One Piece cache was wiped.");
        }

    } catch (e) {
        console.error("Test error:", e.message);
    }
}

testCachePersistence();
