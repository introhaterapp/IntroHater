const { spawn } = require('child_process');
const http = require('http');

console.log("Starting server...");
const server = spawn('node', ['server_lite.js'], { stdio: 'pipe' });

server.stdout.on('data', (d) => process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));

setTimeout(() => {
    console.log("Fetching stats...");
    http.get('http://localhost:7005/api/stats', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            console.log('\nSTATS_RESPONSE:', data);
            try {
                const json = JSON.parse(data);
                if (json.users !== undefined && json.savedTime !== undefined) {
                    console.log("VERIFICATION SUCCESS");
                } else {
                    console.log("VERIFICATION FAILURE: Missing keys");
                }
            } catch (e) {
                console.log("VERIFICATION FAILURE: Invalid JSON");
            }
            server.kill();
            process.exit(0);
        });
    }).on('error', (e) => {
        console.log('FETCH_ERROR:', e.message);
        server.kill();
        process.exit(1);
    });
}, 4000);
