export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function notFound(res) {
  sendJson(res, 404, { error: 'No encontrado' });
}

export function unauthorized(res) {
  sendJson(res, 401, { error: 'No autorizado' });
}

export function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}
