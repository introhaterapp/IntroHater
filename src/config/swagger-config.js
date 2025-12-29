

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'IntroHater API',
            version: '1.0.0',
            description: 'API for managing intro skip segments for videos. IntroHater automatically skips intros, outros, and recaps in Stremio.',
            contact: {
                name: 'IntroHater',
                url: 'https://github.com/introhaterapp/IntroHater'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: 'https://introhater.com',
                description: 'Production server'
            },
            {
                url: 'http://localhost:7005',
                description: 'Development server'
            }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key'
                },
                RdKeyAuth: {
                    type: 'apiKey',
                    in: 'body',
                    name: 'rdKey',
                    description: 'Real-Debrid API Key for authentication'
                }
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message'
                        }
                    }
                },
                Segment: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: 'abc123def456' },
                        videoId: { type: 'string', example: 'tt3107288:1:1' },
                        start: { type: 'number', example: 120.5 },
                        end: { type: 'number', example: 180.2 },
                        label: { type: 'string', example: 'Intro' },
                        votes: {
                            type: 'object',
                            properties: {
                                up: { type: 'number', example: 42 },
                                down: { type: 'number', example: 3 }
                            }
                        },
                        submittedBy: { type: 'string', example: 'a1b2c3d4' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                Stats: {
                    type: 'object',
                    properties: {
                        users: { type: 'number', example: 1250 },
                        skips: { type: 'number', example: 150000 },
                        savedTime: { type: 'number', example: 3600000 },
                        showCount: { type: 'number', example: 5000 },
                        episodeCount: { type: 'number', example: 25000 },
                        sources: {
                            type: 'object',
                            properties: {
                                local: { type: 'number' },
                                aniskip: { type: 'number' },
                                animeSkip: { type: 'number' }
                            }
                        }
                    }
                },
                LeaderboardUser: {
                    type: 'object',
                    properties: {
                        rank: { type: 'number', example: 1 },
                        userId: { type: 'string', example: 'a1b2c3d4' },
                        segments: { type: 'number', example: 150 },
                        votes: { type: 'number', example: 500 },
                        savedTime: { type: 'number', example: 36000 }
                    }
                },
                ActivityItem: {
                    type: 'object',
                    properties: {
                        videoId: { type: 'string', example: 'tt3107288:1:3' },
                        title: { type: 'string', example: 'Attack on Titan' },
                        episode: { type: 'string', example: 'S1E3' },
                        label: { type: 'string', example: 'Intro' },
                        timestamp: { type: 'string', format: 'date-time' }
                    }
                }
            }
        },
        tags: [
            { name: 'Public', description: 'Public endpoints (no auth required)' },
            { name: 'Segments', description: 'Skip segment management' },
            { name: 'User', description: 'User-related operations (RD Key required)' },
            { name: 'Admin', description: 'Admin-only operations' }
        ]
    },
    apis: [
        './src/routes/*.js'
    ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
