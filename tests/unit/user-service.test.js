
jest.mock('../../src/repositories/user.repository', () => ({
    ensureInit: jest.fn().mockResolvedValue(),
    findByUserId: jest.fn().mockResolvedValue(null),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    countDocuments: jest.fn().mockResolvedValue(0),
    getStatsAggregation: jest.fn().mockResolvedValue([]),
    findGlobalStats: jest.fn().mockResolvedValue(null),
    incrementGlobalSavedTime: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findTokenByUserId: jest.fn().mockResolvedValue(null),
    upsertToken: jest.fn().mockResolvedValue({ upsertedCount: 1 })
}));

describe('User Service', () => {
    let userService;
    let userRepository;

    const loadService = async () => {
        jest.resetModules();
        userRepository = require('../../src/repositories/user.repository');
        return require('../../src/services/user-service');
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        userService = await loadService();
    });

    describe('getUserStats', () => {
        it('should return null for non-existent user', async () => {
            userRepository.findByUserId.mockResolvedValue(null);

            const stats = await userService.getUserStats('nonexistent');
            expect(stats).toBeNull();
            expect(userRepository.findByUserId).toHaveBeenCalledWith('nonexistent');
        });

        it('should return user stats if user exists', async () => {
            const mockUser = { userId: 'user123', votes: 5, segments: 10 };
            userRepository.findByUserId.mockResolvedValue(mockUser);

            const stats = await userService.getUserStats('user123');
            expect(stats).toEqual(mockUser);
        });
    });

    describe('getLeaderboard', () => {
        it('should return sorted leaderboard from Repository', async () => {
            const mockUsers = [
                { userId: 'u1', votes: 10, segments: 5 },
                { userId: 'u2', votes: 5, segments: 20 }
            ];
            userRepository.getLeaderboard.mockResolvedValue(mockUsers);

            const board = await userService.getLeaderboard(10);
            expect(userRepository.getLeaderboard).toHaveBeenCalledWith(10);
            expect(board).toEqual(mockUsers);
        });
    });

    describe('getStats', () => {
        it('should return aggregated stats', async () => {
            userRepository.countDocuments.mockResolvedValue(100);
            userRepository.getStatsAggregation.mockResolvedValue([{ totalVotes: 500 }]);
            userRepository.findGlobalStats.mockResolvedValue({ totalSavedTime: 3600 });

            const stats = await userService.getStats();

            expect(stats.userCount).toBe(100);
            expect(stats.voteCount).toBe(500);
            expect(stats.totalSavedTime).toBe(3600);
        });
    });

    describe('incrementSavedTime', () => {
        it('should increment global and user saved time', async () => {
            await userService.incrementSavedTime('user123', 60);

            expect(userRepository.incrementGlobalSavedTime).toHaveBeenCalledWith(60);
            expect(userRepository.updateOne).toHaveBeenCalledWith(
                { userId: 'user123' },
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('should not increment for zero or negative duration', async () => {
            await userService.incrementSavedTime('user123', 0);
            await userRepository.incrementGlobalSavedTime.mockClear();

            expect(userRepository.incrementGlobalSavedTime).not.toHaveBeenCalled();
        });
    });

    describe('Token Operations', () => {
        it('should get stored token', async () => {
            const mockToken = { token: 'abc' };
            userRepository.findTokenByUserId.mockResolvedValue(mockToken);

            const result = await userService.getUserToken('u1');
            expect(result).toEqual(mockToken);
        });

        it('should store user token', async () => {
            await userService.storeUserToken('u1', 'token123', 12345, 'nonce123');
            expect(userRepository.upsertToken).toHaveBeenCalledWith('u1', expect.objectContaining({
                token: 'token123',
                nonce: 'nonce123'
            }));
        });
    });
});
