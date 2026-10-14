// Configuração de publicação: cabeçalhos/cache da Vercel, .vercelignore sem excluir nada usado em produção e /api/auth-config público.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {GET} from '../api/auth-config.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const rule = source => Object.fromEntries((vercel.headers.find(entry => entry.source === source)?.headers || []).map(({key, value}) => [key.toLowerCase(), value]));

test('every route sends CSP and the browser hardening headers', () => {
  const headers = rule('/(.*)'), csp = Object.fromEntries(headers['content-security-policy'].split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(csp['script-src'], ["'self'"], 'No inline scripts or eval');
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  for (const origin of ['https://*.supabase.co', 'https://gmail.googleapis.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com']) assert.ok(csp['connect-src'].includes(origin), origin);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['permissions-policy'], /microphone=\(self\)/);
  assert.match(headers['strict-transport-security'], /^max-age=\d{8}/);
});

test('static folders are cached for a day without immutable (files are not fingerprinted)', () => {
  for (const folder of ['assets', 'vendor', 'downloads']) assert.equal(rule(`/${folder}/(.*)`)['cache-control'], 'public, max-age=86400, stale-while-revalidate=604800');
  assert.equal(JSON.stringify(vercel).includes('immutable'), false);
  for (const name of Object.keys(vercel.functions)) assert.ok(existsSync(new URL('../' + name, import.meta.url)), name);
  assert.equal(existsSync(new URL('../api/project-plan.mjs', import.meta.url)), false, 'Helpers in api/ start with _ so Vercel does not deploy them as functions');
});

test('/api/auth-config is CDN-cached and only returns the public Supabase configuration', async () => {
  const previous = {...process.env};
  Object.assign(process.env, {SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public', GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'private-client-secret', GEMINI_API_KEY: 'private-gemini', FLOW_ALLOWED_EMAILS: '@private.example'});
  try {
    const response = GET(), body = await response.json();
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    assert.deepEqual(Object.keys(body).sort(), ['configured', 'googleRefreshConfigured', 'key', 'url']);
    for (const secret of ['private-client-secret', 'private-gemini', 'client.apps', 'private.example']) assert.equal(JSON.stringify(body).includes(secret), false, secret);
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_private';
    assert.equal(GET().headers.get('cache-control'), 'no-store', 'Errors are never cached');
  } finally { process.env = previous; }
});

test('.vercelignore keeps every file the app, add-on and extension load at runtime', () => {
  const patterns = read('.vercelignore').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  assert.ok(patterns.every(pattern => pattern.startsWith('/') && !pattern.startsWith('!')), 'Only anchored exclusions; new root files stay published');
  const matchers = patterns.map(pattern => new RegExp('^' + pattern.slice(1).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/|$)'));
  const ignored = path => matchers.some(matcher => matcher.test(path));
  const runtime = new Set(['index.html', 'offline.html', 'manifest.webmanifest', 'service-worker.js', 'package.json', 'vercel.json']);
  const local = value => value.replace(/^https:\/\/flow-blue-theta\.vercel\.app\//, '').replace(/^\.?\//, '').split(/[?#]/)[0];
  for (const page of ['index.html', 'offline.html']) for (const [, url] of read(page).matchAll(/(?:src|href)="([^"]+)"/g)) if (!/^(data:|https?:|#|mailto:)/.test(url) && local(url)) runtime.add(local(url));
  for (const icon of JSON.parse(read('manifest.webmanifest')).icons) runtime.add(local(icon.src));
  for (const file of readdirSync(new URL('..', import.meta.url)).filter(name => name.endsWith('.js') || name.endsWith('.css'))) {
    runtime.add(file);
    for (const [, path] of read(file).matchAll(/['"`(]\.?\/?((?:assets|vendor|downloads)\/[^'"`)\s]+)/g)) runtime.add(path);
  }
  for (const [, path] of read('gmail-addon/appsscript.json').matchAll(/https:\/\/flow-blue-theta\.vercel\.app\/([^"]+)/g)) runtime.add(path);
  for (const file of readdirSync(new URL('../downloads', import.meta.url))) runtime.add('downloads/' + file);
  for (const file of readdirSync(new URL('../api', import.meta.url))) runtime.add('api/' + file);
  for (const path of runtime) {
    assert.equal(ignored(path), false, `${path} is used at runtime`);
    assert.ok(existsSync(new URL('../' + path, import.meta.url)), `${path} exists`);
  }
  for (const path of ['tests/cloud-sync.test.mjs', 'docs/ATIVACAO-GOOGLE.md', 'supabase/flow.sql', 'gmail-addon/Code.gs', 'extensao-chrome/manifest.json', 'scripts/package-extension.py', 'server.mjs', '.env.example', 'README.md'])
    assert.equal(ignored(path), true, `${path} is not published`);
});
