const http = require('http');
const https = require('https');
const os = require('os');

const DEFAULT_NEW_SCREEN_URL = 'http://localhost:3001';

function isBackendPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/assets/store' || pathname.startsWith('/assets/store/');
}

function normalizeLocalAddress(address) {
  const value = String(address || '').trim();
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value;
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function configuredNewScreenUrl(options = {}) {
  const configured = String(options.newScreenUrl || process.env.CLIENT_URL || DEFAULT_NEW_SCREEN_URL).trim();
  const target = new URL(configured);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('CLIENT_URL must use http or https.');
  }
  if (target.username || target.password) {
    throw new Error('CLIENT_URL must not include credentials.');
  }
  return target;
}

function localIpv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flatMap(entries => Array.isArray(entries) ? entries : [])
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address);
}

function newScreenTargets(req, options = {}) {
  const configured = configuredNewScreenUrl(options);
  const targets = [];

  if (isLoopbackHostname(configured.hostname)) {
    const requestAddress = normalizeLocalAddress(req?.socket?.localAddress);
    const localAddresses = [requestAddress, ...localIpv4Addresses()]
      .filter(address => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address));

    for (const address of localAddresses) {
      const localTarget = new URL(configured.href);
      localTarget.hostname = address;
      targets.push(localTarget);
    }
  }

  targets.push(configured);
  return targets.filter((target, index, all) =>
    all.findIndex(candidate => candidate.origin === target.origin && candidate.pathname === target.pathname) === index
  );
}

function targetRequestUrl(target, requestUrl) {
  const basePath = target.pathname === '/' ? '' : target.pathname.replace(/\/$/, '');
  const incoming = String(requestUrl || '/');
  return new URL(`${basePath}${incoming.startsWith('/') ? incoming : `/${incoming}`}`, target.origin);
}

function proxyHeaders(req, target) {
  return {
    ...req.headers,
    host: target.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'https'
  };
}

function publicOrigin(req) {
  return req.headers.host ? `https://${req.headers.host}` : '';
}

function rewrittenResponseHeaders(headers, target, req) {
  const result = { ...headers };
  const location = String(result.location || '');
  const origin = publicOrigin(req);
  if (location && origin && location.startsWith(target.origin)) {
    result.location = `${origin}${location.slice(target.origin.length)}`;
  }
  return result;
}

function proxyNewScreenRequest(req, res, options = {}) {
  let targets;
  try {
    targets = newScreenTargets(req, options);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`New screen proxy configuration error: ${error.message}`);
    return;
  }

  const retryable = req.method === 'GET' || req.method === 'HEAD';

  const attempt = (index) => {
    const target = targets[index];
    const requestUrl = targetRequestUrl(target, req.url);
    const transport = target.protocol === 'https:' ? https : http;
    const proxyRequest = transport.request(requestUrl, {
      method: req.method,
      headers: proxyHeaders(req, target)
    }, proxyResponse => {
      proxyResponse.on('error', () => res.destroy());
      res.writeHead(
        proxyResponse.statusCode || 502,
        rewrittenResponseHeaders(proxyResponse.headers, target, req)
      );
      proxyResponse.pipe(res);
    });

    proxyRequest.on('error', () => {
      if (retryable && index + 1 < targets.length) {
        attempt(index + 1);
        return;
      }
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
      }
      res.end('New screen is unavailable. Start the Next.js client on port 3001.');
    });

    req.on('aborted', () => proxyRequest.destroy());
    if (retryable) proxyRequest.end();
    else req.pipe(proxyRequest);
  };

  attempt(0);
}

function createHttpsFrontendHandler(backendApp, options = {}) {
  if (typeof backendApp !== 'function') throw new TypeError('backendApp must be a request handler.');

  return (req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'https://local.invalid').pathname;
    } catch {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    if (isBackendPath(pathname)) {
      backendApp(req, res);
      return;
    }
    proxyNewScreenRequest(req, res, options);
  };
}

function attachNewScreenUpgradeProxy(server, options = {}) {
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let targets;
    try {
      targets = newScreenTargets(req, options);
    } catch {
      socket.destroy();
      return;
    }

    const attempt = (index) => {
      const target = targets[index];
      const requestUrl = targetRequestUrl(target, req.url);
      const transport = target.protocol === 'https:' ? https : http;
      const proxyRequest = transport.request(requestUrl, {
        method: req.method,
        headers: proxyHeaders(req, target)
      });

      proxyRequest.on('upgrade', (proxyResponse, proxySocket, proxyHead) => {
        proxySocket.on('error', () => socket.destroy());
        const headerLines = Object.entries(proxyResponse.headers)
          .flatMap(([name, value]) => Array.isArray(value)
            ? value.map(item => `${name}: ${item}`)
            : value === undefined ? [] : [`${name}: ${value}`]);
        socket.write(`HTTP/1.1 ${proxyResponse.statusCode || 101} Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`);
        if (head?.length) proxySocket.write(head);
        if (proxyHead?.length) socket.write(proxyHead);
        proxySocket.pipe(socket).pipe(proxySocket);
      });

      proxyRequest.on('response', proxyResponse => {
        socket.write(`HTTP/1.1 ${proxyResponse.statusCode || 502} Proxy Error\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      });

      proxyRequest.on('error', () => {
        if (index + 1 < targets.length) attempt(index + 1);
        else socket.destroy();
      });
      proxyRequest.end();
    };

    attempt(0);
  });
}

module.exports = {
  attachNewScreenUpgradeProxy,
  createHttpsFrontendHandler,
  isBackendPath,
  newScreenTargets
};
