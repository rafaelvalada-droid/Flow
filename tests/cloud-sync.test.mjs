// cloud.js em um contexto isolado: mesclagem em três vias, 409 idempotente, intervalo de gravação, abas,
// mensagens de erro, cópias de segurança e tokens Google. Supabase e Google são simulados; nenhuma conta real.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../cloud.js', import.meta.url), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', URL_BASE = 'https://sync-test.supabase.co', SESSION = 'flow.auth.session.v1', KEY = 'flow.workspace.v1:' + A;
const user = {id: A, email: 'a@example.test'};
const plain = value => JSON.parse(JSON.stringify(value));
const task = (id, extra = {}) => ({id, title: 'Tarefa ' + id, project: 'area', status: 'todo', dueDate: '2026-10-20', sessions: [], subtasks: [], ...extra});
const workspace = (tasks, extra = {}) => ({version: 1, projects: [{id: 'area', name: 'Área'}], tasks, preferences: {focusMinutes: 25}, ...extra});
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({row = {revision: 1, data: workspace([task('t1'), task('t2')])}, values: initial = [], session = {}} = {}) {
  const values = new Map([[SESSION, JSON.stringify({project: URL_BASE, user, access_token: 'test-access', refresh_token: 'test-refresh', expires_at: 2100000000, ...session})], ...initial]);
  const quota = {full: false};
  const storage = {getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => { if (quota.full) throw Object.assign(new Error('QuotaExceededError'), {name: 'QuotaExceededError'}); values.set(k, String(v)); }, removeItem: k => values.delete(k), key: i => [...values.keys()][i] ?? null, get length() { return values.size; }};
  const server = {row: row && plain(row), saves: [], revokes: [], requests: [], hold: null, failSave: null, loseResponse: false, userId: A};
  const listeners = {}, events = [], timers = new Map(), timeouts = [];
  let nextTimer = 0, reloads = 0;
  const fetch = async (url, options = {}) => {
    server.requests.push(url);
    if (url === '/api/auth-config') return Response.json({configured: true, url: URL_BASE, key: 'sb_publishable_test'});
    if (url === 'https://oauth2.googleapis.com/revoke') { server.revokes.push({token: new URLSearchParams(options.body).get('token'), mode: options.mode, keepalive: options.keepalive}); return new Response(null, {status: 200}); }
    if (server.hold?.match(url)) await server.hold.promise;
    if (url.endsWith('/auth/v1/user')) return Response.json({...user, id: server.userId});
    if (url.endsWith('/auth/v1/logout?scope=local')) return Response.json({});
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) return Response.json({error: 'invalid_grant', error_description: 'Invalid Refresh Token'}, {status: 400});
    if (url.includes('/rest/v1/flow_workspaces?')) return Response.json(server.row ? [plain(server.row)] : []);
    if (url.endsWith('/rest/v1/rpc/flow_save_workspace')) {
      const body = JSON.parse(options.body);
      server.saves.push(body);
      if (server.failSave) return Response.json(server.failSave.body, {status: server.failSave.status});
      if (body.expected_revision !== (server.row?.revision || 0)) return Response.json({code: 'PT409', message: 'Workspace revision conflict'}, {status: 409});
      server.row = {revision: body.expected_revision + 1, data: body.workspace_data};
      if (server.loseResponse) { server.loseResponse = false; throw new TypeError('Failed to fetch'); }
      return Response.json({revision: server.row.revision});
    }
    throw new Error('Unexpected request ' + url);
  };
  const context = {URL, URLSearchParams, TextEncoder, navigator: {}, console,
    AbortSignal: {timeout: ms => { timeouts.push(ms); return AbortSignal.timeout(ms); }},
    location: {search: '', pathname: '/', hash: '', reload() { reloads++; }}, history: {replaceState() {}},
    window: {dispatchEvent: event => { events.push(event); }, addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); }},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: {querySelector: () => ({hidden: false})},
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, {fn, ms}); return id; }, clearTimeout: id => timers.delete(id),
    localStorage: storage, fetch};
  vm.createContext(context);
  vm.runInContext(source, context);
  const cloud = context.FlowCloud;
  return {cloud, values, server, events, timers, timeouts, quota, reloads: () => reloads,
    // Dispara os temporizadores pendentes (o intervalo de 500 ms) e espera as promessas resultantes.
    async fire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); for (let i = 0; i < 20; i++) await tick(); },
    storage(key, newValue) { for (const fn of listeners.storage || []) fn({key, newValue}); },
    stored: () => JSON.parse(values.get(SESSION)),
    merged: () => events.filter(event => event.type === 'flow:cloud-remote-merged'),
    uploads: () => server.requests.filter(url => url.endsWith('/rest/v1/rpc/flow_save_workspace')).length};
}

test('three-way merge: phone capture added remotely and a local edit are both kept, remote order first', () => {
  const {cloud} = harness({row: null});
  const base = workspace([task('t1'), task('t2')]);
  const local = workspace([task('t1', {title: 'Editada aqui'}), task('t2')]);
  const remote = workspace([task('phone', {source: 'gmail-addon'}), task('t1'), task('t2')]);
  const result = plain(cloud.merge(base, local, remote));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value.tasks.map(t => t.id), ['phone', 't1', 't2']);
  assert.equal(result.value.tasks[1].title, 'Editada aqui');
});
test('three-way merge: new items from both sides survive; local new items keep their local position', () => {
  const {cloud} = harness({row: null});
  const base = workspace([task('t1'), task('t2')]);
  const local = workspace([task('mine'), task('t1'), task('t2'), task('last')]);
  const remote = workspace([task('t1'), task('t2'), task('theirs')]);
  const result = plain(cloud.merge(base, local, remote));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value.tasks.map(t => t.id), ['mine', 't1', 't2', 'last', 'theirs']);
});
test('three-way merge: deletions apply only when the other side left the item unchanged', () => {
  const {cloud} = harness({row: null});
  const base = workspace([task('t1'), task('t2'), task('t3')]);
  let result = plain(cloud.merge(base, workspace([task('t1'), task('t3')]), workspace([task('t1'), task('t2'), task('t3', {title: 'Remoto'})])));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value.tasks.map(t => [t.id, t.title]), [['t1', 'Tarefa t1'], ['t3', 'Remoto']]);
  result = plain(cloud.merge(base, workspace([task('t1'), task('t2', {status: 'doing'}), task('t3')]), workspace([task('t1'), task('t3')])));
  assert.deepEqual(result.conflicts, ['/tasks/t2']);
  result = plain(cloud.merge(base, workspace([task('t1'), task('t2'), task('t3')]), workspace([task('t1'), task('t3')])));
  assert.deepEqual(result.value.tasks.map(t => t.id), ['t1', 't3']);
  result = plain(cloud.merge(base, workspace([task('t1'), task('t3')]), workspace([task('t2', {title: 'Mudou'}), task('t3')])));
  assert.deepEqual(result.conflicts, ['/tasks/t2']);
});
test('three-way merge: objects merge key by key; equal changes agree; different changes conflict', () => {
  const {cloud} = harness({row: null});
  const base = workspace([task('t1')], {gmailReviews: {x: {state: 'pending'}}});
  const local = workspace([task('t1', {title: 'Novo título'})], {preferences: {focusMinutes: 30}, gmailReviews: {x: {state: 'accepted'}}});
  const remote = workspace([task('t1', {dueDate: '2026-11-01'})], {gmailReviews: {x: {state: 'accepted'}, y: {state: 'ignored'}}});
  let result = plain(cloud.merge(base, local, remote));
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value.tasks[0], task('t1', {title: 'Novo título', dueDate: '2026-11-01'}));
  assert.equal(result.value.preferences.focusMinutes, 30);
  assert.deepEqual(result.value.gmailReviews, {x: {state: 'accepted'}, y: {state: 'ignored'}});
  result = plain(cloud.merge(base, workspace([task('t1', {title: 'Aqui'})]), workspace([task('t1', {title: 'Lá'})])));
  assert.deepEqual(result.conflicts, ['/tasks/t1/title']);
  const withKey = workspace([task('t1', {description: 'texto'})]);
  result = plain(cloud.merge(withKey, workspace([task('t1')]), withKey));
  assert.equal('description' in result.value.tasks[0], false, 'A key removed on one side stays removed');
});
test('three-way merge: arrays without ids take the only changed side and conflict when both changed', () => {
  const {cloud} = harness({row: null});
  const base = workspace([task('t1', {sessions: [{start: 1, end: 2}]})]);
  const grown = workspace([task('t1', {sessions: [{start: 1, end: 2}, {start: 3, end: 4}]})]);
  let result = plain(cloud.merge(base, grown, base));
  assert.deepEqual(result.value.tasks[0].sessions.length, 2);
  result = plain(cloud.merge(base, grown, workspace([task('t1', {sessions: [{start: 1, end: 2}, {start: 5, end: 6}]})])));
  assert.deepEqual(result.conflicts, ['/tasks/t1/sessions']);
});
test('three-way merge: a local-only reorder is kept and remote additions follow their neighbour', () => {
  const {cloud} = harness({row: null});
  const area = id => ({id, name: id});
  const base = workspace([], {projects: [area('a'), area('b'), area('c')]});
  const result = plain(cloud.merge(base, workspace([], {projects: [area('c'), area('a'), area('b')]}), workspace([], {projects: [area('a'), area('new'), area('b'), area('c')]})));
  assert.deepEqual(result.value.projects.map(p => p.id), ['c', 'a', 'new', 'b']);
});
test('three-way merge never pollutes prototypes from untrusted keys', () => {
  const {cloud} = harness({row: null});
  const evil = JSON.parse('{"version":1,"tasks":[],"projects":[],"__proto__":{"polluted":true}}');
  const result = cloud.merge({version: 1, tasks: [], projects: []}, evil, {version: 1, tasks: [], projects: []});
  assert.equal(result.value.polluted, undefined);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
  assert.equal(({}).polluted, undefined);
});

test('startup checks the account and loads the workspace in parallel, and never returns data for another account', async () => {
  const h = harness();
  let release;
  h.server.hold = {match: url => url.endsWith('/auth/v1/user'), promise: new Promise(resolve => { release = resolve; })};
  const started = h.cloud.initialize();
  for (let i = 0; i < 20 && !h.server.requests.some(url => url.includes('/flow_workspaces?')); i++) await tick();
  assert.ok(h.server.requests.some(url => url.includes('/rest/v1/flow_workspaces?user_id=eq.' + A)), 'Workspace request starts before the account check finishes');
  release();
  const result = plain(await started);
  assert.equal(result.mode, 'cloud');
  assert.equal(result.data.tasks.length, 2);
  const other = harness();
  other.server.userId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  await assert.rejects(other.cloud.initialize(), /verificar sua conta/);
  assert.equal(other.cloud.info().mode, 'local');
});

test('a lost save response is adopted on the next 409 without a second write or a conflict', async () => {
  const h = harness();
  await h.cloud.initialize();
  const next = workspace([task('t1'), task('t2'), task('t3')]);
  h.server.loseResponse = true;
  h.cloud.queue(next);
  await assert.rejects(h.cloud.flush(), /Verifique a conexão/);
  assert.equal(h.cloud.info().status, 'error');
  assert.equal(h.server.row.revision, 2);
  await h.cloud.flush();
  assert.equal(h.cloud.info().status, 'saved');
  assert.equal(h.server.saves.length, 2, 'Only the retried save hits 409; nothing is rewritten');
  assert.equal(h.values.get(KEY + '.revision'), '2');
  assert.equal(h.values.has(KEY + '.pending'), false);
  h.cloud.queue(workspace([task('t1'), task('t2'), task('t3'), task('t4')]));
  await h.cloud.flush();
  assert.equal(h.server.saves.at(-1).expected_revision, 2);
  assert.equal(h.server.row.revision, 3);
});

test('a 409 caused by a phone capture merges automatically, saves once more and tells the interface', async () => {
  const h = harness();
  await h.cloud.initialize();
  // O complemento do celular grava uma tarefa direto no Supabase e incrementa a revisão.
  h.server.row = {revision: 2, data: workspace([task('phone'), task('t1'), task('t2')])};
  h.cloud.queue(workspace([task('t1', {title: 'Editada no computador'}), task('t2')]));
  await h.cloud.flush();
  assert.equal(h.cloud.info().status, 'saved');
  assert.equal(h.server.row.revision, 3);
  assert.deepEqual(h.server.row.data.tasks.map(t => [t.id, t.title]), [['phone', 'Tarefa phone'], ['t1', 'Editada no computador'], ['t2', 'Tarefa t2']]);
  assert.equal(h.merged().length, 1);
  assert.deepEqual(plain(h.merged()[0].detail.data), h.server.row.data);
  assert.deepEqual(JSON.parse(h.values.get(KEY)), h.server.row.data, 'The local cache holds the merged workspace');
  assert.equal(h.values.get(KEY + '.revision'), '3');
});

test('a real conflict keeps the conflict status and never overwrites the other device', async () => {
  const h = harness();
  await h.cloud.initialize();
  h.server.row = {revision: 2, data: workspace([task('t1', {title: 'Celular'}), task('t2')])};
  h.cloud.queue(workspace([task('t1', {title: 'Computador'}), task('t2')]));
  await assert.rejects(h.cloud.flush(), /Outra aba ou dispositivo/);
  assert.equal(h.cloud.info().status, 'conflict');
  assert.equal(h.server.row.data.tasks[0].title, 'Celular');
  assert.equal(h.merged().length, 0);
  assert.equal(h.values.get(KEY + '.pending'), '1');
});

test('with an unknown base (pending data after reload and a newer cloud revision) the conflict screen stays', async () => {
  const h = harness({values: [[KEY, JSON.stringify(workspace([task('local')]))], [KEY + '.pending', '1'], [KEY + '.revision', '0']]});
  const result = await h.cloud.initialize();
  assert.equal(h.cloud.info().status, 'conflict');
  assert.equal(plain(result.data).tasks[0].id, 'local');
  await assert.rejects(h.cloud.flush(), /versão nova na nuvem/);
  assert.equal(h.server.saves.length, 0);
});

test('edits made during an upload wait for the 500 ms interval instead of being re-sent at once', async () => {
  const h = harness();
  await h.cloud.initialize();
  let release;
  h.server.hold = {match: url => url.endsWith('/flow_save_workspace'), promise: new Promise(resolve => { release = resolve; })};
  h.cloud.queue(workspace([task('t1', {title: 'a'}), task('t2')]));
  assert.equal(h.timers.size, 1);
  await h.fire();
  assert.equal(h.uploads(), 1);
  for (const title of ['ab', 'abc', 'abcd']) h.cloud.queue(workspace([task('t1', {title}), task('t2')]));
  await h.fire();
  assert.equal(h.uploads(), 1, 'A timer that fires during an upload does not start another one');
  h.server.hold = null; release();
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(h.uploads(), 1, 'The finished upload schedules the next one instead of looping');
  assert.equal(h.cloud.info().status, 'pending');
  assert.equal(h.timers.size, 1);
  await h.fire();
  assert.equal(h.uploads(), 2);
  assert.equal(h.server.row.data.tasks[0].title, 'abcd');
  assert.equal(h.cloud.info().status, 'saved');
});

test('an explicit flush during an upload saves the newest data right after it', async () => {
  const h = harness();
  await h.cloud.initialize();
  let release;
  h.server.hold = {match: url => url.endsWith('/flow_save_workspace'), promise: new Promise(resolve => { release = resolve; })};
  h.cloud.queue(workspace([task('t1', {title: 'primeira'}), task('t2')]));
  const first = h.cloud.flush();
  await tick();
  const second = h.cloud.flush(workspace([task('capture'), task('t1', {title: 'primeira'}), task('t2')]));
  h.server.hold = null; release();
  await first; await second;
  assert.equal(h.server.saves.length, 2);
  assert.equal(h.server.row.data.tasks[0].id, 'capture');
  assert.equal(h.cloud.info().status, 'saved');
});

test('the save timeout grows with the payload and oversized workspaces are stopped before sending', async () => {
  const h = harness();
  await h.cloud.initialize();
  h.cloud.queue(workspace([task('t1', {description: 'x'.repeat(1000000)})]));
  await h.cloud.flush();
  assert.ok(h.timeouts.some(ms => ms >= 35000 && ms < 35100), 'About 1 MB waits 15 s + 20 s');
  h.cloud.queue(workspace([task('t1', {description: 'x'.repeat(2100000)})]));
  const before = h.server.saves.length;
  await assert.rejects(h.cloud.flush(), /limite de 2 MB/);
  assert.equal(h.server.saves.length, before);
  assert.equal(h.cloud.info().status, 'error');
  assert.equal(h.values.get(KEY + '.pending'), '1');
});

test('a full browser storage does not stop the upload or the merge', async () => {
  const h = harness();
  await h.cloud.initialize();
  h.quota.full = true;
  h.cloud.queue(workspace([task('t1'), task('t2'), task('t3')]));
  assert.equal(h.timers.size, 1, 'The debounce timer is scheduled even though .pending could not be written');
  await h.fire();
  assert.equal(h.server.row.revision, 2);
  h.server.row = {revision: 3, data: workspace([task('phone'), task('t1'), task('t2'), task('t3')])};
  h.cloud.queue(workspace([task('t1'), task('t2'), task('t3'), task('t4')]));
  await h.cloud.flush();
  assert.equal(h.cloud.info().status, 'saved');
  assert.deepEqual(h.server.row.data.tasks.map(t => t.id), ['phone', 't1', 't2', 't3', 't4']);
  assert.equal(h.merged().length, 1);
});

test('cloud errors explain the size limit, an expired session and connection failures', async () => {
  const h = harness();
  await h.cloud.initialize();
  h.server.failSave = {status: 400, body: {code: '22023', message: 'Invalid Flow workspace (maximum 2 MB)'}};
  h.cloud.queue(workspace([task('t9')]));
  await assert.rejects(h.cloud.flush(), /limite de 2 MB/);
  h.server.failSave = {status: 413, body: {}};
  await assert.rejects(h.cloud.flush(), /limite de 2 MB/);
  h.server.failSave = {status: 503, body: {}};
  await assert.rejects(h.cloud.flush(), /temporariamente indisponível \(HTTP 503\)/);
  const expired = harness({session: {expires_at: 1}});
  await assert.rejects(expired.cloud.initialize(), /Sua sessão expirou\. Entre novamente\./);
});

test('only the newest cloud backup is kept, on startup and when loading the cloud version', async () => {
  const other = 'flow.workspace.v1:bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb.backup:1';
  const h = harness({values: [[KEY + '.backup:100', 'old'], [KEY + '.backup:300', 'newest'], [KEY + '.backup:200', 'middle'], [other, 'other account']]});
  await h.cloud.initialize();
  const backups = () => [...h.values.keys()].filter(k => k.startsWith(KEY + '.backup:'));
  assert.deepEqual(backups(), [KEY + '.backup:300']);
  assert.equal(h.values.get(other), 'other account');
  h.values.set(KEY, JSON.stringify(workspace([task('local-only')])));
  await h.cloud.loadRemote();
  assert.equal(backups().length, 1);
  assert.match(h.values.get(backups()[0]), /local-only/);
  assert.equal(h.reloads(), 1);
});

test('another tab saving updates this tab revision, so its next save does not conflict', async () => {
  const h = harness();
  await h.cloud.initialize();
  const fromOtherTab = workspace([task('t1'), task('t2'), task('other-tab')]);
  h.server.row = {revision: 2, data: fromOtherTab};
  h.values.set(KEY, JSON.stringify(fromOtherTab));
  h.values.set(KEY + '.revision', '2');
  h.storage(KEY + '.revision', '2');
  h.cloud.queue(fromOtherTab);
  assert.equal(h.timers.size, 0, 'Data already saved by the other tab is not re-sent');
  h.cloud.queue(workspace([task('t1'), task('t2'), task('other-tab'), task('mine')]));
  await h.cloud.flush();
  assert.equal(h.server.saves.at(-1).expected_revision, 2);
  assert.equal(h.server.saves.length, 1);
  assert.equal(h.cloud.info().status, 'saved');
});

test('disconnecting the last Google integration deletes and revokes the tokens; the other one is preserved first', async () => {
  const h = harness({session: {provider_token: 'google-access', provider_refresh_token: 'google-refresh', google_access_expires_at: 2100000000, gmailConnected: true, calendarConnected: true}});
  await h.cloud.initialize();
  h.cloud.disconnectGmail();
  assert.equal(h.cloud.calendarToken(), 'google-access');
  assert.equal(h.stored().provider_refresh_token, 'google-refresh');
  assert.equal(h.server.revokes.length, 0);
  h.cloud.disconnectCalendar();
  await tick();
  assert.equal(h.cloud.calendarToken(), null);
  assert.equal(h.cloud.gmailToken(), null);
  const stored = h.stored();
  assert.equal('provider_token' in stored || 'provider_refresh_token' in stored || 'google_access_expires_at' in stored, false);
  assert.deepEqual(plain(h.server.revokes), [{token: 'google-refresh', mode: 'no-cors', keepalive: true}, {token: 'google-access', mode: 'no-cors', keepalive: true}]);
  assert.equal(stored.access_token, 'test-access', 'The UlbraFlow session itself stays signed in');
});

test('signing out revokes the Google grant and removes the session', async () => {
  const h = harness({session: {provider_token: 'google-access', provider_refresh_token: 'google-refresh', gmailConnected: true}});
  await h.cloud.initialize();
  await h.cloud.signOut();
  assert.deepEqual(h.server.revokes.map(r => r.token), ['google-refresh', 'google-access']);
  assert.equal(h.values.has(SESSION), false);
});

test('a plain Google sign-in does not keep Google tokens; only Gmail or Agenda consent stores them', async () => {
  for (const [proof, expected] of [[{}, undefined], [{gmail: true}, 'google-refresh']]) {
    const values = new Map(), sessionStorage = new Map([['flow.auth.pkce.v1', JSON.stringify({verifier: 'v'.repeat(43), createdAt: Date.now(), calendar: false, gmail: false, ...proof})]]);
    const context = {URL, URLSearchParams, TextEncoder, navigator: {}, console, AbortSignal, history: {replaceState() {}},
      location: {search: '?code=test-code', pathname: '/', hash: ''}, window: {dispatchEvent() {}, addEventListener() {}}, CustomEvent: class {},
      setTimeout, clearTimeout, sessionStorage: {getItem: k => sessionStorage.get(k) ?? null, removeItem: k => sessionStorage.delete(k)},
      localStorage: {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)},
      fetch: async url => Response.json(url === '/api/auth-config' ? {configured: true, url: URL_BASE, key: 'sb_publishable_test'} :
        url.includes('/auth/v1/token') ? {access_token: 'test-access', refresh_token: 'r', expires_in: 3600, user, provider_token: 'google-access', provider_refresh_token: 'google-refresh'} :
        url.endsWith('/auth/v1/user') ? user : [])};
    vm.createContext(context); vm.runInContext(source, context); await context.FlowCloud.initialize();
    const stored = JSON.parse(values.get(SESSION));
    assert.equal(stored.provider_refresh_token, expected);
    assert.equal(stored.gmailConnected, !!proof.gmail);
  }
});
