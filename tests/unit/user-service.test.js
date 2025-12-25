/**
 * User Service Unit Tests
 * Tests user stats, leaderboard, and token operations with mocked MongoDB.
 */

const mongoService = require('../../src/services/mongodb');

// Mock MongoDB service
jest.mock('../../src/services/mongodb', () => ({
    getCollection: jest.fn(),
    close: jest.fn()
}));

describe('User Service', () => {
    let userService;
    let mockCollection;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup mock collection with all required methods
        mockCollection = {
            createIndex: jest.fn().mockResolvedValue(true),
            findOne: jest.fn(),
            find: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn(),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            countDocuments: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockReturnThis()
        };

        mongoService.getCollection.mockResolvedValue(mockCollection);

        // Clear module cache to get fresh instance
        jest.resetModules();
        userService = require('../../src/services/user-service');
    });

    afterAll(async () => {
        await mongoService.close();
    });

    describe('getUserStats', () => {
        it('should return null for non-existent user', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const stats = await userService.getUserStats('nonexistent');
            expect(stats).toBeNull();
            expect(mockCollection.findOne).toHaveBeenCalledWith({ userId: 'nonexistent' });
        });

        it('should return user stats if user exists', async () => {
            const mockUser = { userId: 'user123', votes: 5, segments: 10 };
            mockCollection.findOne.mockResolvedValue(mockUser);

            const stats = await userService.getUserStats('user123');
            expect(stats).toEqual(mockUser);
        });
    });

    describe('getLeaderboard', () => {
        it('should return sorted leaderboard from MongoDB', async () => {
            const mockUsers = [
                { userId: 'u1', votes: 10, segments: 5 },
                { userId: 'u2', votes: 5, segments: 20 }
            ];
            mockCollection.toArray.mockResolvedValue(mockUsers);

            const board = await userService.getLeaderboard(10);

            expect(mockCollection.find).toHaveBeenCalled();
            expect(mockCollection.sort).toHaveBeenCalledWith({ votes: -1, segments: -1 });
            expect(mockCollection.limit).toHaveBeenCalledWith(10);
            expect(board).toEqual(mockUsers);
        });

        it('should return empty array if no users', async () => {
            mockCollection.toArray.mockResolvedValue([]);

            const board = await userService.getLeaderboard();
            expect(board).toEqual([]);
        });
    });

    describe('getStats', () => {
        it('should return aggregated stats', async () => {
            mockCollection.countDocuments.mockResolvedValue(100);
            mockCollection.toArray.mockResolvedValue([{ totalVotes: 500 }]);
            mockCollection.findOne.mockResolvedValue({ totalSavedTime: 3600 });

            const stats = await userService.getStats();

            expect(stats.userCount).toBe(100);
            expect(stats.voteCount).toBe(500);
            expect(stats.totalSavedTime).toBe(3600);
        });
    });

    describe('incrementSavedTime', () => {
        it('should increment global and user saved time', async () => {
            await userService.incrementSavedTime('user123', 60);

            // Should update global stats
            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { userId: 'GLOBAL_STATS' },
                { $inc: { totalSavedTime: 60 } },
                { upsert: true }
            );
        });

        it('should not increment for zero or negative duration', async () => {
            await userService.incrementSavedTime('user123', 0);
            await userService.incrementSavedTime('user123', -10);

            // Should not call updateOne for global stats increment
            expect(mockCollection.updateOne).not.toHaveBeenCalledWith(
                { userId: 'GLOBAL_STATS' },
                expect.anything(),
                expect.anything()
            );
        });
    });
});
