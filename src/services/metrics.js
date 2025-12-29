
const client = require('prom-client');


const register = new client.Registry();


client.collectDefaultMetrics({ register });




const httpRequestsTotal = new client.Counter({
    name: 'introhater_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});


const httpRequestDuration = new client.Histogram({
    name: 'introhater_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
});


const skipsServed = new client.Counter({
    name: 'introhater_skips_served_total',
    help: 'Total number of skip segments served',
    labelNames: ['source'], 
    registers: [register]
});


const segmentsSubmitted = new client.Counter({
    name: 'introhater_segments_submitted_total',
    help: 'Total number of segments submitted by users',
    registers: [register]
});


const activeConnections = new client.Gauge({
    name: 'introhater_active_websocket_connections',
    help: 'Number of active WebSocket connections',
    registers: [register]
});


const hlsProxyRequests = new client.Counter({
    name: 'introhater_hls_proxy_requests_total',
    help: 'Total HLS proxy requests',
    labelNames: ['type'], 
    registers: [register]
});


const cacheOperations = new client.Counter({
    name: 'introhater_cache_operations_total',
    help: 'Cache hit/miss operations',
    labelNames: ['operation'], 
    registers: [register]
});




function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const end = process.hrtime.bigint();
        const durationSeconds = Number(end - start) / 1e9;

        
        let route = req.route ? req.route.path : req.path;

        
        route = route
            .replace(/\/tt\d+[^/]*/g, '/:id')      
            .replace(/\/[0-9a-f]{24}/g, '/:mongoId') 
            .replace(/\?.*$/, '');                   

        const labels = {
            method: req.method,
            route: route || 'unknown',
            status_code: res.statusCode
        };

        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, durationSeconds);
    });

    next();
}


async function getMetrics() {
    return register.metrics();
}


function getContentType() {
    return register.contentType;
}



function incSkipsServed(source = 'local') {
    skipsServed.inc({ source });
}

function incSegmentsSubmitted() {
    segmentsSubmitted.inc();
}

function setActiveConnections(count) {
    activeConnections.set(count);
}

function incActiveConnections() {
    activeConnections.inc();
}

function decActiveConnections() {
    activeConnections.dec();
}

function incHlsProxyRequest(type = 'manifest') {
    hlsProxyRequests.inc({ type });
}

function incCacheHit() {
    cacheOperations.inc({ operation: 'hit' });
}

function incCacheMiss() {
    cacheOperations.inc({ operation: 'miss' });
}

module.exports = {
    register,
    metricsMiddleware,
    getMetrics,
    getContentType,
    incSkipsServed,
    incSegmentsSubmitted,
    setActiveConnections,
    incActiveConnections,
    decActiveConnections,
    incHlsProxyRequest,
    incCacheHit,
    incCacheMiss
};
