// Rotas com sessão Supabase: identidade Google obrigatória, FLOW_ALLOWED_EMAILS e cota diária da IA (simulados).
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAccess} from '../api/auth-config.mjs';
import {POST as review} from '../api/gmail-review.mjs';
import {POST as googleToken} from '../api/google-token.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const google = (email = 'pessoa@ulbra.br', extra = {}) => ({id: ID, email, app_metadata: {provider: 'google', providers: ['google']}, identities: [{provider: 'google', identity_data: {sub: 'google-sub', email, email_verified: true}}], ...extra});
const emailOnly = {id: ID, email: 'pessoa@ulbra.br', app_metadata: {provider: 'email', providers: ['email']}, identities: [{provider: 'email', identity_data: {email: 'pessoa@ulbra.br'}}]};
const gemini = {candidates: [{content: {parts: [{text: JSON.stringify({summary: 'Resumo', title: 'Título', areaId: '', dueDate: '', dateEvidence: '', needsReview: true, alert: ''})}]}}]};

async function call(handler, request, {user = google(), quota = {status: 200, body: {allowed: true, used: 1, limit: 300}}, env = {}} = {}) {
  const keys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'GEMINI_API_KEY', 'FLOW_ALLOWED_EMAILS', 'FLOW_AI_DAILY_LIMIT', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])), originalFetch = globalThis.fetch, originalWarn = console.warn;
  Object.assign(process.env, {SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', GEMINI_API_KEY: 'test-gemini', GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret'});
  delete process.env.FLOW_ALLOWED_EMAILS; delete process.env.FLOW_AI_DAILY_LIMIT;
  Object.assign(process.env, env);
  const calls = [], warnings = [];
  console.warn = message => warnings.push(message);
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    if (url.endsWith('/rest/v1/rpc/flow_ai_quota_hit')) { if (quota.network) throw new TypeError('offline'); return Response.json(quota.body, {status: quota.status}); }
    if (url.includes('generativelanguage.googleapis.com')) return Response.json(gemini);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'renewed', expires_in: 3600});
    if (url.endsWith('/oauth2/v3/userinfo')) return Response.json({sub: 'google-sub', email: user.email, email_verified: true});
    throw new Error('Unexpected request ' + url);
  };
  try { const response = await handler(request()); return {status: response.status, body: await response.json(), calls, warnings}; }
  finally { globalThis.fetch = originalFetch; console.warn = originalWarn; for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}
const reviewRequest = (body = {subject: 'Assunto', text: 'Texto do e-mail', areas: []}) => () => new Request('https://flow.test/api/gmail-review', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + 'a'.repeat(30)}, body: JSON.stringify(body)});
const tokenRequest = () => new Request('https://flow.test/api/google-token', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + 'a'.repeat(30)}, body: JSON.stringify({refreshToken: 'test-google-refresh-token'})});
const reachedGemini = calls => calls.some(call => call.url.includes('generativelanguage'));

test('accountAccess requires a Google identity and applies FLOW_ALLOWED_EMAILS emails and @domains case-insensitively', () => {
  assert.equal(accountAccess(google()).ok, true);
  assert.equal(accountAccess({id: ID, app_metadata: {provider: 'google'}}).ok, true);
  assert.deepEqual([accountAccess(emailOnly).ok, accountAccess(emailOnly).status], [false, 403]);
  assert.equal(accountAccess({id: ID, email: 'x@y.z'}).ok, false);
  const env = {FLOW_ALLOWED_EMAILS: ' Chefe@Example.com , @ULBRA.br '};
  assert.equal(accountAccess(google('pessoa@ulbra.br'), env).ok, true);
  assert.equal(accountAccess(google('CHEFE@example.com'), env).ok, true);
  assert.equal(accountAccess(google('outra@example.com'), env).ok, false);
  assert.equal(accountAccess(google('pessoa@ulbra.br.evil.com'), env).ok, false);
  assert.equal(accountAccess(google('pessoa@sub.ulbra.br'), env).ok, false);
  // O e-mail principal não substitui o e-mail confirmado da identidade Google.
  const linked = google('intrusa@gmail.com', {email: 'pessoa@ulbra.br'});
  assert.equal(accountAccess(linked, env).ok, false);
  const unverified = google('pessoa@ulbra.br');unverified.identities[0].identity_data.email_verified = false;
  assert.equal(accountAccess(unverified, env).ok, false);
});

test('Gemini review rejects email/password and non-allowlisted accounts before spending the key or the quota', async () => {
  let result = await call(review, reviewRequest(), {user: emailOnly});
  assert.equal(result.status, 403); assert.match(result.body.error, /conta Google/);
  assert.equal(result.calls.length, 1);
  result = await call(review, reviewRequest(), {user: google('estranho@gmail.com'), env: {FLOW_ALLOWED_EMAILS: '@ulbra.br'}});
  assert.equal(result.status, 403); assert.match(result.body.error, /não está autorizada/);
  assert.equal(result.calls.length, 1);
  result = await call(review, reviewRequest(), {env: {FLOW_ALLOWED_EMAILS: '@ulbra.br'}});
  assert.equal(result.status, 200); assert.ok(reachedGemini(result.calls));
});

test('the daily quota runs with the user JWT before Gemini and returns 429 in Portuguese when exhausted', async () => {
  let result = await call(review, reviewRequest(), {env: {FLOW_AI_DAILY_LIMIT: '25'}});
  const quota = result.calls.find(call => call.url.endsWith('/rpc/flow_ai_quota_hit'));
  assert.equal(quota.options.headers.authorization, 'Bearer ' + 'a'.repeat(30));
  assert.equal(quota.options.headers.apikey, 'sb_publishable_test');
  assert.deepEqual(JSON.parse(quota.options.body), {daily_limit: 25});
  assert.ok(result.calls.indexOf(quota) < result.calls.findIndex(call => call.url.includes('generativelanguage')));
  result = await call(review, reviewRequest(), {quota: {status: 200, body: {allowed: false, used: 301, limit: 300}}});
  assert.equal(result.status, 429); assert.match(result.body.error, /limite de 300 usos da IA hoje/);
  assert.equal(reachedGemini(result.calls), false);
});

test('invalid requests do not consume quota; quota failures close the route except while the SQL is not installed', async () => {
  let result = await call(review, reviewRequest({subject: 'x', text: '', areas: []}));
  assert.equal(result.status, 400); assert.equal(result.calls.some(call => call.url.includes('quota')), false);
  for (const quota of [{status: 404, body: {code: 'PGRST202', message: 'Could not find the function'}}, {status: 400, body: {code: '42883'}}]) {
    result = await call(review, reviewRequest(), {quota});
    assert.equal(result.status, 200); assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /supabase\/flow\.sql/);
  }
  for (const quota of [{status: 500, body: {}}, {status: 200, body: {}}, {network: true}]) {
    result = await call(review, reviewRequest(), {quota});
    assert.equal(result.status, 503); assert.equal(reachedGemini(result.calls), false);
  }
});

test('Google token renewal applies the same Google identity and allowlist rules', async () => {
  let result = await call(googleToken, tokenRequest, {user: emailOnly});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call(googleToken, tokenRequest, {user: google('fora@gmail.com'), env: {FLOW_ALLOWED_EMAILS: 'chefe@ulbra.br,@ulbra.br'}});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call(googleToken, tokenRequest, {env: {FLOW_ALLOWED_EMAILS: '@ulbra.br'}});
  assert.equal(result.status, 200); assert.equal(result.body.accessToken, 'renewed');
});
