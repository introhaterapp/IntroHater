const axios = require('axios');

async function testSort() {
    try {
        console.log("Testing Ascending...");
        const resAsc = await axios.get('http://localhost:7005/api/catalog', {
            params: {
                draw: 1,
                start: 0,
                length: 1,
                order: [
                    { column: 0, dir: 'asc' }
                ]
            }
        });
        console.log("Ascending:", resAsc.data.data[0][0]);

        console.log("\nTesting Descending...");
        const resDesc = await axios.get('http://localhost:7005/api/catalog', {
            params: {
                draw: 2,
                start: 0,
                length: 1,
                order: [
                    { column: 0, dir: 'desc' }
                ]
            }
        });
        console.log("Descending:", resDesc.data.data[0][0]);
    } catch (e) {
        console.error("Test failed:", e.message);
    }
}

testSort();
