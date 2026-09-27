const http = require('http');
const { createHttpsFrontendHandler, isBackendPath } = require('./new_screen_proxy');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname, headers: { host: `phone.local:${port}` } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

describe('HTTPS new-screen entry point', () => {
  test('keeps API and stored image paths in the backend application', () => {
    expect(isBackendPath('/api/runs')).toBe(true);
    expect(isBackendPath('/assets/store/run.png')).toBe(true);
    expect(isBackendPath('/')).toBe(false);
    expect(isBackendPath('/coros-import-notifications-sw.js')).toBe(false);
  });

  test('proxies the new screen and service worker while preserving backend routes', async () => {
    const upstream = http.createServer((req, res) => {
      res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(`${req.url}|${req.headers['x-forwarded-proto']}|${req.headers['x-forwarded-host']}`);
    });
    const upstreamPort = await listen(upstream);

    const backend = (req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end(`backend:${req.url}`);
    };
    const frontend = http.createServer(createHttpsFrontendHandler(backend, {
      newScreenUrl: `http://127.0.0.1:${upstreamPort}`
    }));
    const frontendPort = await listen(frontend);

    try {
      const home = await request(frontendPort, '/');
      const worker = await request(frontendPort, '/coros-import-notifications-sw.js');
      const api = await request(frontendPort, '/api/runs');
      const image = await request(frontendPort, '/assets/store/run.png');

      expect(home.status).toBe(200);
      expect(home.body).toBe(`/|https|phone.local:${frontendPort}`);
      expect(worker.headers['content-type']).toContain('text/javascript');
      expect(worker.body).toContain('/coros-import-notifications-sw.js|https');
      expect(api.body).toBe('backend:/api/runs');
      expect(image.body).toBe('backend:/assets/store/run.png');
    } finally {
      await close(frontend);
      await close(upstream);
    }
  });
});
