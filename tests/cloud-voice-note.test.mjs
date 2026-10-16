// Lembretes de voz: validação do corpo, acesso e cota antes do Gemini, envio do áudio e códigos de reenvio em WAV.
import test from 'node:test';
import assert from 'node:assert/strict';
import {POST as voiceNote, parseVoiceBody, MAX_BODY} from '../api/voice-note.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const google = {id: ID, email: 'pessoa@ulbra.br', app_metadata: {provider: 'google', providers: ['google']}, identities: [{provider: 'google', identity_data: {sub: 'google-sub', email: 'pessoa@ulbra.br', email_verified: true}}]};
const emailOnly = {id: ID, email: 'pessoa@ulbra.br', app_metadata: {provider: 'email', providers: ['email']}, identities: [{provider: 'email', identity_data: {email: 'pessoa@ulbra.br'}}]};
const AUDIO = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////'.repeat(4);
const answer = value => Response.json({candidates: [{content: {parts: [{text: JSON.stringify(value)}]}}]});

async function call(body, {user = google, gemini = () => answer({text: 'Ligar para a coordenação.', title: 'Ligar para a coordenação'}), env = {}, headers = {}} = {}) {
  const keys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'GEMINI_API_KEY', 'GEMINI_REVIEW_MODEL', 'FLOW_ALLOWED_EMAILS', 'FLOW_AI_DAILY_LIMIT'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  Object.assign(process.env, {SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', GEMINI_API_KEY: 'test-gemini'});
  for (const key of ['GEMINI_REVIEW_MODEL', 'FLOW_ALLOWED_EMAILS', 'FLOW_AI_DAILY_LIMIT']) delete process.env[key];
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    if (url.endsWith('/rest/v1/rpc/flow_ai_quota_hit')) return Response.json({allowed: true, used: 1, limit: 300});
    if (url.includes('generativelanguage.googleapis.com')) return gemini(JSON.parse(options.body));
    throw new Error('Unexpected request ' + url);
  };
  try {
    const request = new Request('https://flow.test/api/voice-note', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + 'a'.repeat(30), ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
    const response = await voiceNote(request);
    return {status: response.status, body: await response.json(), calls, gemini: calls.find(call => call.url.includes('generativelanguage'))};
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}

test('parseVoiceBody accepts browser recordings and rejects oversized, unknown or malformed input', () => {
  assert.deepEqual(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'audio/webm;codecs=opus', audio: AUDIO})), {mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO});
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'Audio/MP4', audio: AUDIO})).mimeType, 'audio/mp4');
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'audio/wav', audio: AUDIO + '=='})).mimeType, 'audio/wav');
  assert.equal(parseVoiceBody('x'.repeat(MAX_BODY + 1)).status, 413);
  assert.equal(parseVoiceBody('{').status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'video/webm', audio: AUDIO})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'audio/webm', audio: 'abc'})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO + '"><script>'})).status, 400);
  assert.deepEqual(parseVoiceBody(JSON.stringify({mode: 'improve', text: 'Ligar amanhã'})), {mode: 'improve', text: 'Ligar amanhã'});
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'improve', text: '   '})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'improve', text: 'x'.repeat(8001)})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({mode: 'apagar'})).error, 'Ação inválida.');
});

test('transcription sends the recording inline to Gemini after auth and quota and returns text and title', async () => {
  const result = await call({mode: 'transcribe', mimeType: 'audio/webm;codecs=opus', audio: AUDIO});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {text: 'Ligar para a coordenação.', title: 'Ligar para a coordenação', modelUsed: 'gemini-2.5-flash'});
  assert.deepEqual(result.calls.map(call => new URL(call.url).pathname), ['/auth/v1/user', '/rest/v1/rpc/flow_ai_quota_hit', '/v1beta/models/gemini-2.5-flash:generateContent']);
  assert.equal(result.gemini.options.headers['x-goog-api-key'], 'test-gemini');
  const sent = JSON.parse(result.gemini.options.body);
  assert.deepEqual(sent.contents[0].parts[0], {inlineData: {mimeType: 'audio/webm', data: AUDIO}});
  assert.equal(sent.generationConfig.temperature, 0);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.match(sent.systemInstruction.parts[0].text, /Transcreva fielmente/);
});

test('improve sends only the text and keeps the schema', async () => {
  const result = await call({mode: 'improve', text: 'ligar coordenação escala amanhã'}, {gemini: () => answer({text: 'Ligar amanhã para a coordenação sobre a escala.', title: 'Ligar para a coordenação'})});
  assert.equal(result.status, 200); assert.equal(result.body.text, 'Ligar amanhã para a coordenação sobre a escala.');
  const sent = JSON.parse(result.gemini.options.body);
  assert.deepEqual(sent.contents[0].parts, [{text: 'ligar coordenação escala amanhã'}]);
  assert.equal(sent.generationConfig.temperature, 0.3);
  assert.match(sent.systemInstruction.parts[0].text, /sem inventar/);
});

test('missing session, other providers and bad bodies stop before the quota and the Gemini key', async () => {
  let result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {headers: {authorization: ''}});
  assert.equal(result.status, 401); assert.equal(result.calls.length, 0);
  result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {user: emailOnly});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {env: {FLOW_ALLOWED_EMAILS: '@outro.br'}});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call({mode: 'transcribe', mimeType: 'text/html', audio: AUDIO});
  assert.equal(result.status, 400); assert.equal(result.calls.length, 1);
  result = await call({mode: 'improve', text: 'x'}, {headers: {'content-type': 'text/plain'}});
  assert.equal(result.status, 415); assert.equal(result.calls.length, 1);
  result = await call({mode: 'improve', text: 'x'}, {env: {GEMINI_API_KEY: undefined}});
  assert.equal(result.status, 503); assert.equal(result.calls.length, 0);
});

test('a refused audio format and silence come back with codes that let the browser resend as WAV', async () => {
  const refused = () => Response.json({error: {code: 400, message: 'Unsupported MIME type: audio/webm', status: 'INVALID_ARGUMENT'}}, {status: 400});
  let result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {gemini: refused});
  assert.equal(result.status, 502); assert.equal(result.body.code, 'audio-format'); assert.equal(result.body.upstreamStatus, 400);
  result = await call({mode: 'improve', text: 'Ligar amanhã'}, {gemini: refused});
  assert.equal(result.status, 502); assert.equal(result.body.code, undefined);
  result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => Response.json({error: {code: 429}}, {status: 429})});
  assert.equal(result.status, 502); assert.equal(result.body.code, undefined); assert.match(result.body.error, /HTTP 429/);
  result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => answer({text: '', title: ''})});
  assert.equal(result.status, 422); assert.equal(result.body.code, 'no-speech'); assert.match(result.body.error, /nenhuma fala/);
  result = await call({mode: 'transcribe', mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => Response.json({candidates: [{content: {parts: [{text: 'não é JSON'}]}}]})});
  assert.equal(result.status, 502); assert.match(result.body.error, /não devolveu o texto/);
});

test('long answers are trimmed to the task limits', async () => {
  const result = await call({mode: 'improve', text: 'Ligar'}, {gemini: () => answer({text: 'a'.repeat(9000), title: 'b'.repeat(400)})});
  assert.equal(result.status, 200); assert.equal(result.body.text.length, 7500); assert.equal(result.body.title.length, 180);
});
