const { NoSQLClient } = require('oracle-nosqldb');
const fs = require('fs');
const path = require('path');
// require('dotenv').config(); // Not needed if using defaults/system env

// Config (Copied from existing code)
// Adjust these if your config is not in default location for Windows
const HEADER = `
=========================================
      IntroHater Oracle Exporter
=========================================
`;

async function exportData() {
    console.log(HEADER);

    // Attempt to find config
    const homeDir = process.env.USERPROFILE || process.env.HOME;
    let configPath = path.join(homeDir, '.oci', 'config');

    console.log(`[1/3] Looking for OCI Config at: ${configPath}`);

    if (!fs.existsSync(configPath) && homeDir === '/root') {
        const ubuntuConfig = '/home/ubuntu/.oci/config';
        if (fs.existsSync(ubuntuConfig)) {
            console.log(`   ➜ Not found in root. switching to: ${ubuntuConfig}`);
            configPath = ubuntuConfig;
        }
    }

    if (!fs.existsSync(configPath)) {
        console.error("❌ ERROR: OCI Config file not found!");
        console.error(`   Checked: ${configPath}`);
        console.error("   Please ensure you have your Oracle Cloud credentials in ~/.oci/config");
        process.exit(1);
    }

    const clientConfig = {
        region: process.env.ORACLE_REGION || 'us-phoenix-1',
        compartment: process.env.ORACLE_COMPARTMENT_ID || 'REDACTED',
        auth: {
            iam: {
                configFile: configPath,
                profileName: 'DEFAULT'
            }
        }
    };

    let client;
    try {
        console.log("[2/3] Connecting to Oracle Database...");
        client = new NoSQLClient(clientConfig);

        // Test connection
        await client.get('segments', { segmentId: 'test' }).catch(() => { });
        console.log("✅ Connected!");

        console.log("[3/3] Fetching all segments...");
        const result = await client.query('SELECT * FROM segments');
        const rows = result.rows || [];

        console.log(`✅ Found ${rows.length} segments.`);

        // Transform to IntroHater Lite format
        const exportData = {};

        rows.forEach(row => {
            // Row schema from oracle.js: { segmentId, videoId, startTime, endTime, ... }
            if (!exportData[row.videoId]) {
                exportData[row.videoId] = [];
            }

            exportData[row.videoId].push({
                start: row.startTime,
                end: row.endTime,
                label: 'Intro', // Assume Intro for all legacy data
                votes: row.totalVotes
            });
        });

        const outputPath = path.join(__dirname, '../src/data/skips.json');

        // Merge with existing if exists
        if (fs.existsSync(outputPath)) {
            console.log("   Merging with existing skips.json...");
            const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
            Object.assign(exportData, existing);
        }

        // Write to file (Optional)
        try {
            fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 4));
            console.log(`\n🎉 SUCCESS! Data saved to: ${outputPath}`);
        } catch (writeErr) {
            console.warn(`\n⚠️  Could not save file locally (that's okay): ${writeErr.message}`);
        }

        console.log("---------------- COPY BELOW ----------------");
        console.log(JSON.stringify(exportData, null, 4));
        console.log("---------------- COPY ABOVE ----------------");
        console.log(`\n   1. Copy the JSON between the lines above.`);
        console.log(`   2. Paste it into your local 'src/data/skips.json' file.`);

    } catch (e) {
        console.error("\n❌ FAILED:", e.message);
        if (e.message.includes("authentication")) {
            console.error("   (Check your .oci/config and key file permissions)");
        }
    } finally {
        if (client) client.close();
    }
}

exportData();
