/**
 * Local HTTPS proxy that impersonates https://sphere.score.us.es on THIS machine,
 * so the real US CAS flow can be tested end-to-end without deploying:
 *
 *   browser → ssopre.us.es (real login) → redirect to sphere.score.us.es/...callback
 *           → resolved locally to 127.0.0.1 → this proxy → local API on :8081
 *
 * Setup:
 *   1. Generate a self-signed cert (once):
 *        openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
 *          -keyout scripts/.local-sso.key -out scripts/.local-sso.crt \
 *          -subj "/CN=sphere.score.us.es"
 *   2. Add to C:\Windows\System32\drivers\etc\hosts (as admin):
 *        127.0.0.1 sphere.score.us.es
 *      (REMOVE IT AFTERWARDS or you will not reach the real deployment!)
 *   3. Run: npx tsx scripts/localSsoProxy.ts   (listens on :443)
 *
 * The browser will warn about the self-signed certificate — accept it for the test.
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_PORT = Number(process.env.LOCAL_API_PORT ?? 8081);
const LISTEN_PORT = Number(process.env.LOCAL_SSO_PROXY_PORT ?? 443);

const key = fs.readFileSync(path.join(__dirname, '.local-sso.key'));
const cert = fs.readFileSync(path.join(__dirname, '.local-sso.crt'));

const server = https.createServer({ key, cert }, (req, res) => {
  const proxied = http.request(
    { host: '127.0.0.1', port: TARGET_PORT, path: req.url, method: req.method, headers: req.headers },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    }
  );
  proxied.on('error', (err) => {
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(proxied);
  console.log(`[local-sso-proxy] ${req.method} ${req.url}`);
});

server.listen(LISTEN_PORT, () => {
  console.log(`[local-sso-proxy] https://sphere.score.us.es (local :${LISTEN_PORT}) → http://127.0.0.1:${TARGET_PORT}`);
});
