import express, { json } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();

const servers = {
    "/api/v1" : ["http://192.168.0.1", "http://192.168.0.2", "http://192.168.0.3"],
    "/api/v2": ["http://192.168.0.1", "http://192.168.0.2", "http://192.168.0.3"]
};

const serverQueue = {
    "/api/v1": [...servers["/api/v1"]],
    "/api/v2": [...servers["/api/v2"]]
};

const downServers = new Set();
const requestLog = {
    "/api/v1": new Map(),
    "/api/v2": new Map()
};

function getNextServer(endpoint) {
    const queue = serverQueue[endpoint];
    const server = queue.shift();
    queue.push(server);
    return server;
}

function proxyMiddleware(endpoint) {
    return createProxyMiddleware({
        target: getNextServer(endpoint),
        changeOrigin: true,
        onProxyReq: (proxyReq, req, res) => {
            console.log(`Forward request to: ${proxyReq.getHeader('host')}`);
            const server = proxyReq.getHeader('host');
            if (!requestLog[endpoint].has(server)) {
                requestLog[endpoint].set(server, 0);
            }
            requestLog[endpoint].set(server, requestLog[endpoint].get(server) + 1);
        },
        onError: (err, req, res) => {
            console.error(`Error proxying request: ${err.message}`);
            res.status(500).send('Proxy error');
        }
    });
}

app.use('/api/v1', (req, res, next) => {
    if (downServers.has(getNextServer('/api/v1'))) {
        return res.status(503).send('Server is down');
    }
    proxyMiddleware('/api/v1')(req, res, next);
});

app.use('/api/v2', (req, res, next) => {
    if (downServers.has(getNextServer('/api/v2'))) {
        return res.status(503).send('Server is down');
    }
    proxyMiddleware('/api/v2')(req, res, next);
});

app.post('/server/down', json(), (req, res) => {
    const { server } = req.body;
    downServers.add(server);
    Object.values(serverQueue).forEach(queue => {
        const index = queue.indexOf(server);
        if (index !== -1) queue.splice(index, 1);
    });
    res.json({ message: `Server ${server} marked as down` });
});

app.post('/server/up', json(), (req, res) => {
    const { server } = req.body;
    downServers.delete(server);
    Object.entries(servers).forEach(([endpoint, serverList]) => {
        if (serverList.includes(server)) {
            serverQueue[endpoint].push(server);
        }
    });
    res.json({ message: `Server ${server} marked as up` });
});

app.get('/requests', (req, res) => {
    res.json(requestLog);
});

app.listen(3000, () => {
    console.log('Reverse proxy server running on port 3000');
});
