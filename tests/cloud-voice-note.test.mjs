// Criar demanda com Gemini: validação do corpo, acesso e cota antes do Gemini, áudio ou texto com áreas e calendário,
// área e prazo conferidos no servidor e códigos de reenvio em WAV.
import test from 'node:test';
import assert from 'node:assert/strict';
import {POST as voiceNote, parseVoiceBody, validateDemand, calendar, MAX_BODY} from '../api/voice-note.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const google = {id: ID, email: 'pessoa@ulbra.br', app_metadata: {provider: 'google', providers: ['google']}, identities: [{provider: 'google', identity_data: {sub: 'google-sub', email: 'pessoa@ulbra.br', email_verified: true}}]};
const emailOnly = {id: ID, email: 'pessoa@ulbra.br', app_metadata: {provider: 'email', providers: ['email']}, identities: [{provider: 'email', identity_data: {email: 'pessoa@ulbra.br'}}]};
const AUDIO = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////'.repeat(4);
const AREAS = [{id: 'oferta', name: 'Oferta de turmas'}, {id: 'folha', name: 'Folha docente'}];
const base = {mode: 'demand', today: '2026-10-16', areas: AREAS};
const DEMAND = {transcript: 'Relatório de matrículas. Classificação oferta. Consolidar os números. Sexta que vem. Reserve uma hora e meia. Subtarefas: um, levantar os dados; dois, montar a planilha.', title: 'Relatório de matrículas', areaId: 'oferta', projectId: '', description: 'Consolidar os números.', dueDate: '2026-10-23', dateEvidence: 'sexta que vem', duration: 90, subtasks: ['Levantar os dados', 'Montar a planilha']};
const PROJECTS = [{id: 'caixa', name: 'Caixa da ouvidoria', areaId: 'folha'}];
const answer = value => Response.json({candidates: [{content: {parts: [{text: JSON.stringify(value)}]}}]});

async function call(body, {user = google, gemini = () => answer(DEMAND), env = {}, headers = {}} = {}) {
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

test('parseVoiceBody accepts a recording or a typed demand with today and the areas, and rejects the rest', () => {
  assert.deepEqual(parseVoiceBody(JSON.stringify({...base, mimeType: 'audio/webm;codecs=opus', audio: AUDIO})), {today: '2026-10-16', areas: AREAS, projects: [], mimeType: 'audio/webm', audio: AUDIO});
  assert.equal(parseVoiceBody(JSON.stringify({...base, mimeType: 'Audio/MP4', audio: AUDIO})).mimeType, 'audio/mp4');
  assert.deepEqual(parseVoiceBody(JSON.stringify({...base, text: 'Conferir a escala'})), {today: '2026-10-16', areas: AREAS, projects: [], text: 'Conferir a escala'});
  assert.deepEqual(parseVoiceBody(JSON.stringify({...base, projects: [{...PROJECTS[0], color: 'x'}], text: 'x'})).projects, PROJECTS);
  for (const projects of ['caixa', [{id: 'p', name: 'P', areaId: 'outra'}], [{id: '', name: 'P', areaId: 'oferta'}], [{id: 'p', name: 3, areaId: 'oferta'}], Array.from({length: 201}, (_, i) => ({id: 'p' + i, name: 'P', areaId: 'oferta'}))]) assert.equal(parseVoiceBody(JSON.stringify({...base, projects, text: 'x'})).error, 'Projetos inválidos.');
  assert.deepEqual(parseVoiceBody(JSON.stringify({...base, areas: [{id: 'a', name: 'A', color: '#fff', extra: 'x'}], text: 'x'})).areas, [{id: 'a', name: 'A'}]);
  assert.equal(parseVoiceBody('x'.repeat(MAX_BODY + 1)).status, 413);
  assert.equal(parseVoiceBody('{').status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({...base, mode: 'transcribe', text: 'x'})).error, 'Ação inválida.');
  for (const today of ['', '2026-02-30', '2026-13-01', '16/10/2026', null]) assert.equal(parseVoiceBody(JSON.stringify({...base, today, text: 'x'})).status, 400, String(today));
  for (const areas of [null, 'oferta', [{id: '', name: 'x'}], [{id: 'x'.repeat(101), name: 'x'}], [{id: 'x', name: 1}], Array.from({length: 101}, (_, i) => ({id: 'a' + i, name: 'A'}))]) assert.equal(parseVoiceBody(JSON.stringify({...base, areas, text: 'x'})).error, 'Áreas inválidas.');
  assert.equal(parseVoiceBody(JSON.stringify({...base, mimeType: 'video/webm', audio: AUDIO})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({...base, mimeType: 'audio/webm', audio: 'abc'})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({...base, mimeType: 'audio/webm', audio: AUDIO + '"><script>'})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({...base, text: '   '})).status, 400);
  assert.equal(parseVoiceBody(JSON.stringify({...base, text: 'x'.repeat(4001)})).status, 400);
});

test('the calendar gives Gemini real weekdays to resolve "sexta", "amanhã" and "dia 25"', () => {
  const days = calendar('2026-10-16');
  assert.equal(days.length, 70);
  assert.deepEqual(days.slice(0, 3), ['2026-10-16 sexta-feira', '2026-10-17 sábado', '2026-10-18 domingo']);
  assert.equal(days[7], '2026-10-23 sexta-feira');
  assert.ok(calendar('2026-12-30').includes('2027-01-01 sexta-feira'));
  assert.ok(calendar('2027-02-27').includes('2027-03-01 segunda-feira'));
});

test('validateDemand keeps only an area from the list and a real date, and drops the evidence without a date', () => {
  const body = {areas: AREAS};
  assert.deepEqual(validateDemand(DEMAND, body), {title: DEMAND.title, description: DEMAND.description, transcript: DEMAND.transcript, areaId: 'oferta', projectId: '', dueDate: '2026-10-23', dateEvidence: 'sexta que vem', duration: 90, subtasks: ['Levantar os dados', 'Montar a planilha']});
  const loose = validateDemand({...DEMAND, title: '  ' + 'x'.repeat(300), areaId: 'inventada', dueDate: '2026-02-30'}, body);
  assert.equal(loose.title.length, 180); assert.equal(loose.areaId, ''); assert.equal(loose.dueDate, ''); assert.equal(loose.dateEvidence, '');
  assert.deepEqual(validateDemand(null, body), {title: '', description: '', transcript: '', areaId: '', projectId: '', dueDate: '', dateEvidence: '', duration: null, subtasks: []});
  assert.deepEqual([30, '45', 0, 4, 721, 'meia hora', 59.6].map(duration => validateDemand({...DEMAND, duration}, body).duration), [30, 45, null, null, null, null, 60]);
  // Projeto nomeado define a área; projeto desconhecido é descartado e a área dita continua valendo.
  const withProject = {areas: AREAS, projects: PROJECTS};
  assert.deepEqual(['areaId', 'projectId'].map(key => validateDemand({...DEMAND, areaId: 'oferta', projectId: 'caixa'}, withProject)[key]), ['folha', 'caixa']);
  assert.deepEqual(['areaId', 'projectId'].map(key => validateDemand({...DEMAND, projectId: 'outro'}, withProject)[key]), ['oferta', '']);
  assert.equal(validateDemand({...DEMAND, areaId: 42}, body).areaId, '');
});

test('subtasks keep the spoken order and drop empty, non-text and excess items', () => {
  const body = {areas: AREAS};
  assert.deepEqual(validateDemand({...DEMAND, subtasks: ['  Levantar os dados ', '', 7, null, 'x'.repeat(300)]}, body).subtasks, ['Levantar os dados', 'x'.repeat(180)]);
  assert.equal(validateDemand({...DEMAND, subtasks: Array.from({length: 40}, (_, i) => 'Etapa ' + (i + 1))}, body).subtasks.length, 30);
  assert.deepEqual(validateDemand({...DEMAND, subtasks: 'levantar, montar'}, body).subtasks, []);
  assert.deepEqual(validateDemand({...DEMAND, subtasks: undefined}, body).subtasks, []);
});

test('a recording goes inline to Gemini with today, the calendar, the areas and the projects, after auth and quota', async () => {
  const result = await call({...base, projects: PROJECTS, mimeType: 'audio/webm;codecs=opus', audio: AUDIO});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {...validateDemand(DEMAND, {areas: AREAS, projects: PROJECTS}), modelUsed: 'gemini-2.5-flash'});
  assert.deepEqual(result.calls.map(call => new URL(call.url).pathname), ['/auth/v1/user', '/rest/v1/rpc/flow_ai_quota_hit', '/v1beta/models/gemini-2.5-flash:generateContent']);
  assert.equal(result.gemini.options.headers['x-goog-api-key'], 'test-gemini');
  const sent = JSON.parse(result.gemini.options.body), parts = sent.contents[0].parts;
  assert.deepEqual(parts[0], {inlineData: {mimeType: 'audio/webm', data: AUDIO}});
  const context = JSON.parse(parts[1].text.replace(/^[^{]*/, ''));
  assert.equal(context.hoje, '2026-10-16 sexta-feira');
  assert.equal(context.calendario[7], '2026-10-23 sexta-feira');
  assert.deepEqual(context.areas, AREAS);
  assert.deepEqual(context.projetos, PROJECTS);
  assert.equal(context.texto, undefined);
  assert.equal(sent.generationConfig.temperature, 0);
  assert.deepEqual(sent.generationConfig.responseSchema.required, ['transcript', 'title', 'areaId', 'projectId', 'description', 'dueDate', 'dateEvidence', 'duration', 'subtasks']);
  assert.deepEqual(sent.generationConfig.responseSchema.properties.duration, {type: 'INTEGER'});
  assert.deepEqual(sent.generationConfig.responseSchema.properties.subtasks, {type: 'ARRAY', items: {type: 'STRING'}});
  const instruction = sent.systemInstruction.parts[0].text;
  assert.match(instruction, /1\) o nome da demanda; 2\) a classificação, que é uma área ou um projeto .*; 3\) a descrição, opcional; 4\) a data em que vai fazer, opcional .*; 5\) o ΔT, isto é, o tempo previsto, opcional .*; e 6\) as subtarefas/);
  assert.match(instruction, /"uma hora" é 60/);
  assert.match(instruction, /nunca invente subtarefas/);
  assert.match(instruction, /sem inventar/);
});

test('a typed demand sends only text and the same context', async () => {
  const result = await call({...base, text: 'Conferir a escala, área folha, até dia 25'}, {gemini: () => answer({...DEMAND, areaId: 'folha', dueDate: '2026-10-25'})});
  assert.equal(result.status, 200); assert.equal(result.body.areaId, 'folha'); assert.equal(result.body.dueDate, '2026-10-25');
  const parts = JSON.parse(result.gemini.options.body).contents[0].parts;
  assert.equal(parts.length, 1); assert.equal(parts[0].inlineData, undefined);
  assert.equal(JSON.parse(parts[0].text.replace(/^[^{]*/, '')).texto, 'Conferir a escala, área folha, até dia 25');
});

test('an area Gemini invents or an impossible date never reaches the app', async () => {
  const result = await call({...base, text: 'x'}, {gemini: () => answer({...DEMAND, areaId: 'secreta', dueDate: '2026-13-01'})});
  assert.equal(result.status, 200); assert.equal(result.body.areaId, ''); assert.equal(result.body.dueDate, ''); assert.equal(result.body.dateEvidence, '');
});

test('missing session, other providers and bad bodies stop before the quota and the Gemini key', async () => {
  let result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {headers: {authorization: ''}});
  assert.equal(result.status, 401); assert.equal(result.calls.length, 0);
  result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {user: emailOnly});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {env: {FLOW_ALLOWED_EMAILS: '@outro.br'}});
  assert.equal(result.status, 403); assert.equal(result.calls.length, 1);
  result = await call({...base, mimeType: 'text/html', audio: AUDIO});
  assert.equal(result.status, 400); assert.equal(result.calls.length, 1);
  result = await call({...base, text: 'x'}, {headers: {'content-type': 'text/plain'}});
  assert.equal(result.status, 415); assert.equal(result.calls.length, 1);
  result = await call({...base, text: 'x'}, {env: {GEMINI_API_KEY: undefined}});
  assert.equal(result.status, 503); assert.equal(result.calls.length, 0);
});

test('a refused audio format and silence come back with codes that let the browser resend as WAV', async () => {
  const refused = () => Response.json({error: {code: 400, message: 'Unsupported MIME type: audio/webm', status: 'INVALID_ARGUMENT'}}, {status: 400});
  let result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {gemini: refused});
  assert.equal(result.status, 502); assert.equal(result.body.code, 'audio-format'); assert.equal(result.body.upstreamStatus, 400);
  result = await call({...base, text: 'Ligar amanhã'}, {gemini: refused});
  assert.equal(result.status, 502); assert.equal(result.body.code, undefined);
  result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => Response.json({error: {code: 429}}, {status: 429})});
  assert.equal(result.status, 502); assert.equal(result.body.code, undefined); assert.match(result.body.error, /HTTP 429/);
  result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => answer({transcript: '', title: '', description: '', areaId: '', dueDate: '', dateEvidence: ''})});
  assert.equal(result.status, 422); assert.equal(result.body.code, 'no-speech'); assert.match(result.body.error, /nenhuma fala/);
  result = await call({...base, text: '???'}, {gemini: () => answer({transcript: '???', title: '', description: '', areaId: '', dueDate: '', dateEvidence: ''})});
  assert.equal(result.status, 422); assert.equal(result.body.code, undefined);
  result = await call({...base, mimeType: 'audio/webm', audio: AUDIO}, {gemini: () => Response.json({candidates: [{content: {parts: [{text: 'não é JSON'}]}}]})});
  assert.equal(result.status, 502); assert.match(result.body.error, /não devolveu a demanda/);
});
