
const crypto = require('crypto');

function generateUserId(rdKey) {
    if (!rdKey) return 'anonymous';
    return crypto.createHash('sha256').update(rdKey).digest('hex').substring(0, 32);
}

const key = "example_rd_key_12345";
const id = generateUserId(key); // "a8..."

console.log(`Key: ${key}`);
console.log(`ID: ${id}`);
console.log(`Length: ${id.length}`);

// Check if 635f3e50a3bdada7483f6c2d can be generated (24 chars)
console.log(`User Example Length: ${"635f3e50a3bdada7483f6c2d".length}`);
