const { createHash, randomBytes } = require('crypto');
const { SECURITY } = require('../config/constants');


const usedNonces = new Map();


setInterval(() => {
  const now = Date.now();
  for (const [nonce, timestamp] of usedNonces.entries()) {
    if (now - timestamp > SECURITY.TOKEN.MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      usedNonces.delete(nonce);
    }
  }
}, 60 * 60 * 1000);

function generateUserToken(userId) {
  if (!process.env.TOKEN_SECRET) {
    console.warn('TOKEN_SECRET not set - using less secure random secret');
  }
  const secret = process.env.TOKEN_SECRET || randomBytes(32).toString('hex');
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');
  const data = `${userId}-${timestamp}-${nonce}`;
  const token = createHash('sha256')
    .update(data + secret)
    .digest('hex');
  return { token, timestamp, nonce };
}

function verifyUserToken(userId, token, timestamp, nonce) {
  if (!userId || !token || !timestamp || !nonce) return false;

  
  if (usedNonces.has(nonce)) {
    return false;
  }

  const secret = process.env.TOKEN_SECRET || randomBytes(SECURITY.TOKEN.MIN_LENGTH).toString('hex');
  const data = `${userId}-${timestamp}-${nonce}`;
  const expectedToken = createHash('sha256')
    .update(data + secret)
    .digest('hex');

  const tokenAge = Date.now() - timestamp;
  const maxAge = SECURITY.TOKEN.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const isValid = token === expectedToken && tokenAge <= maxAge;

  
  if (isValid) {
    usedNonces.set(nonce, Date.now());
  }

  return isValid;
}

function hashIP(ip) {
  const salt = process.env.FIREBASE_PRIVATE_KEY || 'default_fallback_salt_for_ip_hashing_change_me';
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    console.warn('[Security] FIREBASE_PRIVATE_KEY not set. Using default salt for IP hashing.');
  }
  return createHash('sha256')
    .update(ip + salt)
    .digest('hex')
    .slice(0, 16);
}

module.exports = {
  generateUserToken,
  verifyUserToken,
  hashIP
};