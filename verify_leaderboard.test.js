
const express = require('express');
const request = require('supertest');
const router = require('./src/routes/stats');

// Mock services
const userService = require('./src/services/user-service');
// Mock services
jest.mock('./src/services/user-service');
jest.mock('./src/services/skip-service');
jest.mock('./src/services/catalog');

const app = express();
app.use(express.json());
app.use('/api', router);

// Mock Data
userService.getLeaderboard.mockResolvedValue([
    { userId: "635f3e50a3bdada7483f6c2d", segments: 10, votes: 5, savedTime: 100 },
    { userId: "aabbccddeeff112233445566", segments: 20, votes: 10, savedTime: 200 }
]);

describe('GET /api/leaderboard', () => {
    it('should mask userIds', async () => {
        const res = await request(app).get('/api/leaderboard');
        console.log(JSON.stringify(res.body, null, 2));

        expect(res.status).toBe(200);
        expect(res.body.users[0].userId).toBe("635f3e50...");
        expect(res.body.users[1].userId).toBe("aabbccdd...");
    });
});
