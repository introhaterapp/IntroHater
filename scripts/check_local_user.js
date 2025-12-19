const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/data/users.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const user = data.stats.find(s => s.votes === 2);
if (user) {
    console.log("FOUND LOCAL USER:", user);
} else {
    console.log("NO USER with 2 votes found locally.");
}
