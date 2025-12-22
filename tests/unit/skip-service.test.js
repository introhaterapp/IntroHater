const fs = require('fs').promises;
const mongoService = require('../../src/services/mongodb');
const axios = require('axios');

// Hoisted mocks
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn()
    }
}));
jest.mock('axios');
jest.mock('../../src/services/mongodb');
jest.mock('../../src/services/catalog', () => ({
    registerShow: jest.fn().mockResolvedValue(),
    updateCatalog: jest.fn().mockResolvedValue()
}));

describe('Skip Service', () => {
    let skipService;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await mongoService.close();
    });

    const loadService = () => require('../../src/services/skip-service');

    it('should return null if no segment found (Local JSON empty)', async () => {
        // Setup mocks BEFORE require
        mongoService.getCollection.mockResolvedValue(null);
        fs.readFile.mockResolvedValue(JSON.stringify({}));

        // Isolate to ensure fresh init
        await jest.isolateModules(async () => {
            skipService = loadService();
            // Wait for init if needed? getSkipSegment calls ensureInit internally.
            const result = await skipService.getSkipSegment('tt12345:1:1');
            expect(result).toBeNull();
        });
    });

    it('should return segment from local JSON if mongo is not available', async () => {
        mongoService.getCollection.mockResolvedValue(null);
        const mockData = {
            'tt12345:1:1': [{ start: 10, end: 20, label: 'Intro', verified: true }]
        };
        fs.readFile.mockResolvedValue(JSON.stringify(mockData));

        await jest.isolateModules(async () => {
            skipService = loadService();
            // We need to wait for the internal initPromise to resolve implicitly, 
            // but getSkipSegment awaits ensureInit(), so it should be fine.
            const result = await skipService.getSkipSegment('tt12345:1:1');

            // The service returns { start, end } extracted from the segment
            expect(result).toEqual({ start: 10, end: 20 });
        });
    });

    it('should use Aniskip fallback if not in DB', async () => {
        mongoService.getCollection.mockResolvedValue(null);
        fs.readFile.mockResolvedValue(JSON.stringify({}));

        axios.get.mockImplementation((url) => {
            if (url.includes('cinemeta')) {
                return Promise.resolve({ data: { meta: { name: 'Naruto' } } });
            }
            if (url.includes('jikan')) {
                return Promise.resolve({ data: { data: [{ mal_id: 20 }] } });
            }
            if (url.includes('aniskip')) {
                return Promise.resolve({
                    data: {
                        found: true,
                        results: [{ skipType: 'op', interval: { startTime: 100, endTime: 200 } }]
                    }
                });
            }
            return Promise.reject(new Error('not found'));
        });

        await jest.isolateModules(async () => {
            skipService = loadService();
            const result = await skipService.getSkipSegment('tt99999:1:1');
            expect(result).toEqual({ start: 100, end: 200, label: 'Intro', source: 'aniskip' });
        });
    });

    it('should persist Ani-Skip result to DB when found', async () => {
        mongoService.getCollection.mockResolvedValue(null);
        fs.readFile.mockResolvedValue(JSON.stringify({}));

        let saveCalledPromise = new Promise(resolve => {
            fs.writeFile.mockImplementation((path, data) => {
                resolve(data); // Resolve with the data being saved
                return Promise.resolve();
            });
        });

        axios.get.mockImplementation((url) => {
            if (url.includes('cinemeta')) return Promise.resolve({ data: { meta: { name: 'Naruto' } } });
            if (url.includes('jikan')) return Promise.resolve({ data: { data: [{ mal_id: 20 }] } });
            if (url.includes('aniskip')) {
                return Promise.resolve({
                    data: {
                        found: true,
                        results: [{ skipType: 'op', interval: { startTime: 100, endTime: 200 } }]
                    }
                });
            }
            return Promise.reject(new Error('not found'));
        });

        await jest.isolateModules(async () => {
            skipService = loadService();
            await skipService.getSkipSegment('tt88888:1:1');

            // Wait for the save to happen (or timeout if it fails)
            const savedDataJson = await Promise.race([
                saveCalledPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for save')), 1000))
            ]);

            const savedData = JSON.parse(savedDataJson);
            expect(savedData['tt88888:1:1']).toBeDefined();
            expect(savedData['tt88888:1:1'][0].source).toBe('aniskip');
        });
    });

    it('should prioritize Mongo if available', async () => {
        const mockCollection = {
            findOne: jest.fn().mockResolvedValue({
                fullId: 'tt55555:1:1',
                segments: [{ start: 50, end: 60, label: 'Intro' }]
            }),
            createIndex: jest.fn(),
            countDocuments: jest.fn().mockResolvedValue(1)
        };
        mongoService.getCollection.mockResolvedValue(mockCollection);

        await jest.isolateModules(async () => {
            skipService = loadService();
            const result = await skipService.getSkipSegment('tt55555:1:1');
            expect(result).toEqual({ start: 50, end: 60 });
            expect(mockCollection.findOne).toHaveBeenCalled();
            expect(fs.readFile).not.toHaveBeenCalled(); // Should skip local load if Mongo present?
            // Actually code says: if (skipsCollection) ... else loadSkips().
            // So fs.readFile should NOT be called.
        });
    });
});
