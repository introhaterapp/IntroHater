const axios = require('axios');

async function testPerformance() {
    const videoId = 'tt0388629'; // One Piece
    try {
        console.log(`Testing performance for ${videoId}...`);

        const start1 = Date.now();
        const res1 = await axios.get(`http://localhost:7005/api/segments/${videoId}`);
        const duration1 = Date.now() - start1;
        console.log(`Fetch 1 (Cold/Indexed): ${duration1}ms - Count: ${res1.data.length}`);

        const start2 = Date.now();
        const res2 = await axios.get(`http://localhost:7005/api/segments/${videoId}`);
        const duration2 = Date.now() - start2;
        console.log(`Fetch 2 (Warm/Cache): ${duration2}ms - Count: ${res2.data.length}`);

        const start3 = Date.now();
        const res3 = await axios.get(`http://localhost:7005/api/segments/${videoId}`);
        const duration3 = Date.now() - start3;
        console.log(`Fetch 3 (Warm/Cache): ${duration3}ms - Count: ${res3.data.length}`);

        // Verify rounding
        const firstSeg = res1.data[0];
        if (firstSeg) {
            console.log(`Sample Segment: ${firstSeg.start}s - ${firstSeg.end}s (Rounded: ${Number.isInteger(firstSeg.start)})`);
        }

    } catch (e) {
        console.error("Test failed:", e.message);
    }
}

testPerformance();
