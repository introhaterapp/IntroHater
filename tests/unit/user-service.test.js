const userService = require('../../src/services/user-service');
const fs = require('fs').promises;
const mongoService = require('../../src/services/mongodb');

jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn()
    }
}));
jest.mock('../../src/services/mongodb');

describe('User Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset robustly if possible, but isolation is easier if state is internal.
        // We will rely on mocking dependencies to control "state" perception.
    });

    afterAll(async () => {
        await mongoService.close();
    });

    describe('getUserStats', () => {
        it('should return null if not using Mongo and no local data', async () => {
            mongoService.getCollection.mockResolvedValue(null);
            fs.readFile.mockRejectedValue({ code: 'ENOENT' }); // No file

            // Re-require to trigger fresh init
            await jest.isolateModules(async () => {
                const service = require('../../src/services/user-service');
                const stats = await service.getUserStats('user123');
                expect(stats).toBeNull();
            });
        });

        it('should return stats from Mongo if available', async () => {
            const mockUser = { userId: 'user123', votes: 5 };
            const mockCollection = {
                createIndex: jest.fn(),
                findOne: jest.fn().mockResolvedValue(mockUser)
            };
            mongoService.getCollection.mockResolvedValue(mockCollection);

            await jest.isolateModules(async () => {
                const service = require('../../src/services/user-service');
                const stats = await service.getUserStats('user123');
                expect(stats).toEqual(mockUser);
            });
        });
    });

    describe('updateUserStats', () => {
        it('should create new user stats if they do not exist (Local JSON)', async () => {
            mongoService.getCollection.mockResolvedValue(null);
            fs.readFile.mockResolvedValue(JSON.stringify({ stats: [], tokens: [] }));

            await jest.isolateModules(async () => {
                const service = require('../../src/services/user-service');
                const result = await service.updateUserStats('newuser', { segments: 1 });

                expect(result).toMatchObject({ userId: 'newuser', segments: 1 });
                expect(fs.writeFile).toHaveBeenCalled();
            });
        });

        it('should increment votes correctly (Local JSON)', async () => {
            mongoService.getCollection.mockResolvedValue(null);
            const initialData = {
                stats: [{ userId: 'user1', votes: 10, votedVideos: [] }],
                tokens: []
            };
            fs.readFile.mockResolvedValue(JSON.stringify(initialData));

            await jest.isolateModules(async () => {
                const service = require('../../src/services/user-service');
                const result = await service.updateUserStats('user1', { votes: 1, videoId: 'vid1' });

                expect(result.votes).toBe(11); // 10 + 1
                expect(result.votedVideos).toContain('vid1');
            });
        });
    });

    describe('getLeaderboard', () => {
        it('should sort users by votes then segments (Local JSON)', async () => {
            mongoService.getCollection.mockResolvedValue(null);
            const mockData = {
                stats: [
                    { userId: 'u1', votes: 5, segments: 10 },
                    { userId: 'u2', votes: 10, segments: 5 },
                    { userId: 'u3', votes: 5, segments: 20 }
                ],
                tokens: []
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockData));

            await jest.isolateModules(async () => {
                const service = require('../../src/services/user-service');
                const board = await service.getLeaderboard();

                // Expected order: u2 (10 votes), u3 (5 votes, 20 segs), u1 (5 votes, 10 segs)
                expect(board[0].userId).toBe('u2');
                expect(board[1].userId).toBe('u3');
                expect(board[2].userId).toBe('u1');
            });
        });
    });
});
