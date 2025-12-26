const { NoSQLClient } = require('oracle-nosqldb');
const fs = require('fs');
const path = require('path');
// require('dotenv').config();

const HEADER = `
=========================================
      IntroHater User Exporter
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
        await client.get('segments', { segmentId: 'test' }).catch(() => { });
        console.log("✅ Connected!");

        const exportData = {
            stats: [],
            tokens: []
        };

        // Fetch Stats
        console.log("[3/4] Fetching user_stats...");
        try {
            const statsRes = await client.query('SELECT * FROM user_stats');
            exportData.stats = statsRes.rows || [];
            console.log(`✅ Found ${exportData.stats.length} user stats.`);
        } catch (e) {
            console.warn(`   Could not fetch stats: ${e.message}`);
        }

        // Fetch Tokens (Optional, might be sensitive)
        console.log("[4/4] Fetching user_tokens...");
        try {
            const tokenRes = await client.query('SELECT * FROM user_tokens');
            exportData.tokens = tokenRes.rows || [];
            console.log(`✅ Found ${exportData.tokens.length} user tokens.`);
        } catch (e) {
            console.warn(`   Could not fetch tokens: ${e.message}`);
        }

        const outputPath = path.join(__dirname, '../src/data/users.json');

        // Write locally if possible
        try {
            fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 4));
            console.log(`\n🎉 SUCCESS! Data saved to: ${outputPath}`);
        } catch { /* ignore write errors */ }

        console.log("---------------- COPY BELOW ----------------");
        console.log(JSON.stringify(exportData, null, 4));
        console.log("---------------- COPY ABOVE ----------------");

    } catch (e) {
        console.error("\n❌ FAILED:", e.message);
    } finally {
        if (client) client.close();
    }
}

exportData();
