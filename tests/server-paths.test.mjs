// Servidor local real numa porta livre: caminhos do repositório bloqueados, Host restrito e cabeçalhos iguais aos da Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer, request} from 'node:http';
import {connect} from 'node:net';
import {readFileSync} from 'node:fs';

const root = new URL('..', import.meta.url);
const free = () => new Promise(resolve => { const probe = createServer().listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); }); });
const get = (port, path, host = `127.0.0.1:${port}`) => new Promise((resolve, reject) => {
  request({host: '127.0.0.1', port, path, headers: {host}}, response => { response.resume(); response.on('end', () => resolve(response)); }).on('error', reject).end();
});

// Sem cabeçalho Host (HTTP/1.0 cru): também deve ser recusado.
const bare = port => new Promise((resolve, reject) => { let text = ''; connect(port, '127.0.0.1', function () { this.end('GET / HTTP/1.0\r\n\r\n'); }).on('data', data => { text += data; }).on('end', () => resolve(text.split('\r\n')[0])).on('error', reject); });

test('local server hides repository files, rejects foreign Host headers and sends the Vercel security headers', async t => {
  const port = await free();
  const child = spawn(process.execPath, ['server.mjs'], {cwd: root, env: {...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', FLOW_REQUIRE_AUTH: ''}, stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.on('data', data => { if (String(data).includes('disponível')) resolve(); }); child.on('exit', code => reject(new Error('server exited ' + code))); });

  for (const path of ['/', '/index.html', '/manifest.webmanifest', '/offline.html', '/service-worker.js', '/assets/icons/ulbraflow-blue-192.png', '/vendor/jspdf.umd.min.js'])
    assert.equal((await get(port, path)).statusCode, 200, path);
  for (const path of ['//.git/config', '//.env.example', '/.env.example', '//docs/ATIVACAO-GOOGLE.md', '/docs/ATIVACAO-GOOGLE.md', '/./docs/ATIVACAO-GOOGLE.md', '/DOCS/ATIVACAO-GOOGLE.md',
    '//tests/server-paths.test.mjs', '/supabase/flow.sql', '/scripts/package-extension.py', '/gmail-addon/Code.gs', '/extensao-chrome/manifest.json', '//api/gemini.mjs',
    '/api/_project-plan.mjs', '/.vercelignore', '/assets/../.git/config', '/%2e%2e/%2e%2e/etc/passwd', '/assets/%2e%2e/.git/config', '/node_modules/x.js'])
    assert.equal((await get(port, path)).statusCode, 404, path);
  assert.equal((await get(port, '/%E0%A4%A')).statusCode, 400);

  for (const host of ['evil.example', `evil.example:${port}`, 'localhost.evil.example', `127.0.0.1.nip.io:${port}`])
    assert.equal((await get(port, '/', host)).statusCode, 403, host);
  assert.match(await bare(port), / 403 /);
  for (const host of ['localhost', `localhost:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`])
    assert.equal((await get(port, '/', host)).statusCode, 200, host);

  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
  const expected = vercel.headers.find(rule => rule.source === '/(.*)').headers;
  assert.ok(expected.some(header => header.key === 'Content-Security-Policy'));
  for (const path of ['/', '/offline.html', '/app.js', '/api/auth-config']) {
    const response = await get(port, path);
    for (const {key, value} of expected) assert.equal(response.headers[key.toLowerCase()], value, `${path} ${key}`);
  }
});
