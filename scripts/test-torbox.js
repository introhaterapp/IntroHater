require('dotenv').config();
const axios = require('axios');

async function main() {
    let apiKey = process.argv[2] || process.env.TORBOX_API_KEY;

    if (!apiKey) {
        console.error('API Key required: node scripts/test-torbox.js <KEY>');
        process.exit(1);
    }

    try {
        console.log(`\n--- 1. Getting User's Torrent List ---`);
        const listRes = await axios.get('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true', {
            headers: { Authorization: `Bearer ${apiKey}` }
        });

        if (!listRes.data.data || listRes.data.data.length === 0) {
            console.error("❌ You have no torrents in your TorBox account. Please add a small movie/episode manually then run this script again.");
            process.exit(1);
        }

        const torrent = listRes.data.data[0];
        console.log(`✅ Selected Torrent: ${torrent.name} (ID: ${torrent.id}, Hash: ${torrent.hash})`);

        // We need the file_id. 'mylist' returns files array?
        if (!torrent.files || torrent.files.length === 0) {
            console.log("No files in torrent object, checking details...");
            // Maybe we need to fetch info?
            // Actually mylist usually returns files if 'list_files' is not an option?
            // Let's assume files are there or we fetch them.
        }

        let fileId;
        if (torrent.files && torrent.files.length > 0) {
            const largestFile = torrent.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
            fileId = largestFile.id;
            console.log(`✅ Largest file: ${largestFile.name} (ID: ${fileId})`);
        } else {
            console.log("Fetching torrent info to get files...");
            // POST /v1/api/torrents/torrentinfo needs hash
            // GET /v1/api/torrents/exportdata?torrent_id=...
            // Let's try checkcached for the hash to get files?
            const checkRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${torrent.hash}&format=object&list_files=true`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            const cachedItem = checkRes.data.data[torrent.hash];
            const largestFile = cachedItem.files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
            fileId = largestFile.id;
            console.log(`✅ Largest file from cache check: ${largestFile.name} (ID: ${fileId})`);
        }

        console.log(`\n--- 2. Creating Transcoded Stream (id: ${torrent.id}, file_id: ${fileId}) ---`);
        const streamRes = await axios.get(`https://api.torbox.app/v1/api/stream/createstream`, {
            params: {
                id: torrent.id,
                file_id: fileId,
                type: 'torrent'
            },
            headers: { Authorization: `Bearer ${apiKey}` }
        });

        console.log('Response Data Structure:', Object.keys(streamRes.data));
        if (streamRes.data.data) {
            console.log('Response Data.Data Keys:', Object.keys(streamRes.data.data));
            console.log('Response Data Snippet:', JSON.stringify(streamRes.data, null, 2).substring(0, 1000));
        } else {
            console.log('No data.data found.');
            console.log('Full Response:', JSON.stringify(streamRes.data, null, 2).substring(0, 1000));
        }

        const streamUrl = streamRes.data.data ? streamRes.data.data.player : null;

        if (streamUrl) {
            console.log(`\n✅ Stream URL: ${streamUrl}`);

            if (streamUrl.includes('.m3u8')) {
                console.log('✅ It IS an HLS playlist!');

                console.log(`\n--- 3. Inspecting Playlist ---`);
                const playlistRes = await axios.get(streamUrl);
                console.log('Playlist Content (First 20 lines):');
                console.log(playlistRes.data.split('\n').slice(0, 20).join('\n'));
            } else {
                console.log('⚠️ It is NOT an m3u8. It is:', streamUrl);
            }
        } else {
            console.log("Stream URL not found in response.");
        }

    } catch (e) {
        console.error('❌ Error:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}

main();
