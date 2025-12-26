/**
 * WebSocket Activity Ticker Service
 * Real-time broadcasting of new skip segment additions
 */

const WebSocket = require('ws');
const metrics = require('./metrics');
const log = require('../utils/logger').ws;

let wss = null;
let clients = new Set();

/**
 * Initialize WebSocket server attached to HTTP server
 * @param {http.Server} server - The HTTP server instance
 */
function init(server) {
    wss = new WebSocket.Server({ server, path: '/ws/ticker' });

    wss.on('connection', (ws) => {
        clients.add(ws);
        metrics.incActiveConnections();
        log.info({ total: clients.size }, 'Client connected');

        // Send welcome message with current connection count
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to IntroHater Live Ticker',
            clients: clients.size
        }));

        // Heartbeat to keep connection alive
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('close', () => {
            clients.delete(ws);
            metrics.decActiveConnections();
            log.info({ total: clients.size }, 'Client disconnected');
        });

        ws.on('error', (err) => {
            log.error({ err: err.message }, 'Client error');
            clients.delete(ws);
            metrics.decActiveConnections();
        });
    });

    // Heartbeat interval to detect dead connections
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                clients.delete(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000); // 30 second heartbeat

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    log.info('WebSocket ticker server initialized on /ws/ticker');
    return wss;
}

/**
 * Broadcast a new segment addition to all connected clients
 * @param {Object} segment - The segment data to broadcast
 * @param {string} segment.videoId - e.g., "tt1234567:1:3"
 * @param {string} segment.title - Show title
 * @param {string} segment.episode - e.g., "S1E3"
 * @param {string} segment.label - e.g., "Intro", "Outro"
 */
function broadcast(segment) {
    if (!wss) return;

    const message = JSON.stringify({
        type: 'new_segment',
        data: {
            videoId: segment.videoId,
            title: segment.title || segment.videoId.split(':')[0],
            episode: segment.episode || null,
            label: segment.label || 'Intro',
            timestamp: new Date().toISOString()
        }
    });

    let sent = 0;
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                sent++;
            } catch (e) {
                log.error({ err: e.message }, 'Broadcast error');
            }
        }
    });

    if (sent > 0) {
        log.info({ count: sent }, 'Broadcasted new segment');
    }
}

/**
 * Get current connection count
 */
function getConnectionCount() {
    return clients.size;
}

/**
 * Gracefully close all connections
 */
function close() {
    if (wss) {
        wss.clients.forEach((client) => {
            client.close(1001, 'Server shutting down');
        });
        wss.close();
        wss = null;
        clients.clear();
    }
}

module.exports = {
    init,
    broadcast,
    getConnectionCount,
    close
};
