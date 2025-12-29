

const WebSocket = require('ws');
const metrics = require('./metrics');
const log = require('../utils/logger').ws;

let wss = null;
let clients = new Set();


function init(server) {
    wss = new WebSocket.Server({ server, path: '/ws/ticker' });

    wss.on('connection', (ws) => {
        clients.add(ws);
        metrics.incActiveConnections();
        log.info({ total: clients.size }, 'Client connected');

        
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to IntroHater Live Ticker',
            clients: clients.size
        }));

        
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

    
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                clients.delete(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000); 

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    log.info('WebSocket ticker server initialized on /ws/ticker');
    return wss;
}


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


function getConnectionCount() {
    return clients.size;
}


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
