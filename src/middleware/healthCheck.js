/**
 * Health Check Endpoint
 * Provides comprehensive health status for monitoring
 */

const { performance } = require('perf_hooks');
const logger = require('../utils/logger');

class HealthCheck {
    constructor() {
        this.startTime = Date.now();
        this.checks = [];
    }

    // Add a health check function
    addCheck(name, checkFn) {
        this.checks.push({ name, checkFn });
    }

    // Get basic health status
    async getBasicHealth() {
        const uptime = Date.now() - this.startTime;
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(uptime / 1000), // seconds
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
    }

    // Get detailed health status with all checks
    async getDetailedHealth() {
        const start = performance.now();
        const basic = await this.getBasicHealth();
        const checkResults = {};

        // Run all health checks in parallel
        await Promise.all(this.checks.map(async ({ name, checkFn }) => {
            try {
                const result = await Promise.race([
                    checkFn(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 5000)
                    )
                ]);
                checkResults[name] = {
                    status: 'ok',
                    ...result
                };
            } catch (error) {
                checkResults[name] = {
                    status: 'error',
                    error: error.message
                };
                logger.warn(`Health check failed: ${name}`, { error: error.message });
            }
        }));

        const allChecksOk = Object.values(checkResults).every(r => r.status === 'ok');
        const responseTime = Math.round(performance.now() - start);

        return {
            ...basic,
            status: allChecksOk ? 'ok' : 'degraded',
            checks: checkResults,
            responseTime: `${responseTime}ms`
        };
    }

    // Express middleware for basic health check
    basicHandler() {
        return async (req, res) => {
            try {
                const health = await this.getBasicHealth();
                res.json(health);
            } catch (error) {
                logger.error('Health check failed', { error: error.message });
                res.status(503).json({ 
                    status: 'error', 
                    message: 'Service unavailable' 
                });
            }
        };
    }

    // Express middleware for detailed health check
    detailedHandler() {
        return async (req, res) => {
            try {
                const health = await this.getDetailedHealth();
                const statusCode = health.status === 'ok' ? 200 : 503;
                res.status(statusCode).json(health);
            } catch (error) {
                logger.error('Detailed health check failed', { error: error.message });
                res.status(503).json({ 
                    status: 'error', 
                    message: 'Service unavailable' 
                });
            }
        };
    }
}

module.exports = HealthCheck;
