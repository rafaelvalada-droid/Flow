(() => {
  'use strict';
  const SWEEP_MS = 3600000, SWEEP_MARGIN_MS = 300000, BACKOFF_BASE_MS = 5000, BACKOFF_MAX_MS = 300000, RETRY_AFTER_MAX_MS = 3600000;
  const LIMITED = 'O Google Agenda limitou temporariamente as solicitações. O UlbraFlow tentará novamente automaticamente.';
  const UNAVAILABLE = 'O Google Agenda está temporariamente indisponível. O UlbraFlow tentará novamente automaticamente.';
  let getDatabase, persist, timer, running, status = 'disconnected', error = '';
  let visibleRange = null, imported = [], reading = false, readError = '', generation = 0, syncedInput='';
  let poller = null, readTimer = null, taskErrors = [], swept = {owner: null, at: 0}, seen = null, loadedAt = 0;
  // Espera crescente após 429/5xx/sem rede, separada para leitura e escrita; zera no primeiro sucesso.
  const backoff = {read: {failures: 0, until: 0}, write: {failures: 0, until: 0}};
  const deferred = new Set(); // Tarefas com falha transitória vão para o fim da fila e não bloqueiam as demais.
  const info = () => ({connected: !!FlowCloud.calendarToken(), status, error, reading, readError, events: FlowCloud.calendarToken() ? imported : [],
    taskErrors: taskErrors.map(item => ({...item})), retryAt: backoff.write.until > Date.now() ? backoff.write.until : null});
  const emit = () => window.dispatchEvent(new CustomEvent('flow:calendar-status'));
  const state = (next, message = '') => { status = next; error = message; emit(); };
  const failure = (message, extra) => Object.assign(new Error(message), extra);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const usable = id => (typeof id === 'string' && id !== '') || Number.isFinite(id);
  // Falha restrita a uma tarefa (validação, 400/404/409/410/412, evento alheio): registra e segue para as próximas.
  const taskFailure = err => err?.task === true || (err?.status >= 400 && err.status < 500 && ![401, 403, 429].includes(err.status));
  // Quando o workspace é substituído (backup, outra aba), a limpeza de órfãos só considera eventos anteriores à troca.
  function workspace() { const db = getDatabase(); if (db !== seen) { seen = db; loadedAt = Date.now(); } return db; }
  function retryAfter(response) {
    const value = response.headers?.get?.('retry-after');
    if (!value) return undefined;
    const ms = /^\s*\d+\s*$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS) : undefined;
  }
  async function api(path = '', method = 'GET', body) {
    const token = FlowCloud.calendarToken();
    if (!token) throw new Error('Conecte sua conta ao Google Agenda.');
    const url='https://www.googleapis.com/calendar/v3/calendars/primary/events'+path;
    const options={
      method, headers: {Authorization: `Bearer ${token}`, ...(body ? {'content-type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(12000)
    };
    let response;
    try { response=FlowCloud.googleFetch?await FlowCloud.googleFetch('calendar',url,options):await fetch(url,options); }
    catch (err) {
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(err?.name)) throw err;
      throw failure('Sem resposta do Google Agenda. O UlbraFlow tentará novamente automaticamente.', {transient: true});
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 401) {
      FlowCloud.disconnectCalendar();
      throw failure('Autorize o Google Agenda novamente. Confira também se a API Google Calendar está ativada.', {status: 401});
    }
    if(response.status===403){
      const reasons=[...(data?.error?.errors||[]),...(data?.error?.details||[])].map(item=>item?.reason);
      if(reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','RATE_LIMIT_EXCEEDED'].includes(reason)))throw failure(LIMITED,{status:403,transient:true,retryAfter:retryAfter(response)});
      if(reasons.some(reason=>['insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))){FlowCloud.disconnectCalendar();throw failure('Conecte o Google Agenda novamente e autorize a permissão da Agenda.',{status:403});}
      throw failure(reasons.some(reason=>['SERVICE_DISABLED','accessNotConfigured','API_DISABLED'].includes(reason))?'Ative a Google Calendar API no projeto da conexão Google. Sua conexão foi mantida.':'O Google bloqueou o acesso à Agenda. Confira as regras da conta; sua conexão foi mantida.',{status:403});
    }
    if (response.status === 429 || response.status >= 500) throw failure(response.status === 429 ? LIMITED : UNAVAILABLE, {status: response.status, transient: true, retryAfter: retryAfter(response)});
    if (!response.ok) throw failure('Não foi possível sincronizar com o Google Agenda. Tente novamente.', {status: response.status});
    return data;
  }
  // Nunca antes do Retry-After; sem ele, 5 s, 10 s, 20 s… até 5 min.
  function postpone(kind, err) {
    const wait = backoff[kind]; wait.failures++;
    const ms = Math.max(err.retryAfter || 0, Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (wait.failures - 1)));
    wait.until = Date.now() + ms;
    return ms;
  }
  async function list(params) {
    const items = [], pages = new Set();
    let next;
    do {
      const query = new URLSearchParams({...params, maxResults: '250'});
      if (next) query.set('pageToken', next);
      const response = await api('?' + query);
      items.push(...(Array.isArray(response?.items) ? response.items : []));
      next = response?.nextPageToken;
      if (next && pages.has(next)) throw new Error('Não foi possível carregar todos os compromissos. Tente novamente.');
      if (next) pages.add(next);
    } while (next);
    return items;
  }
  const mine = (event, owner) => !!owner && event?.extendedProperties?.private?.flowUserId === owner;
  function armRead(ms) { clearTimeout(readTimer); readTimer = setTimeout(() => { readTimer = null; backoff.read.until = 0; refresh(); }, ms); }
  async function refresh() {
    if (!visibleRange || !FlowCloud.calendarToken()) return;
    const wait = backoff.read.until - Date.now();
    if (wait > 0) { if (!readTimer) armRead(wait); return; }
    const request = ++generation, range = {...visibleRange};
    const owner = FlowCloud.info().user?.id;
    reading = true; readError = ''; emit();
    try {
      const events = await list({timeMin: range.start, timeMax: range.end, singleEvents: 'true', orderBy: 'startTime'});
      if (request !== generation || owner !== FlowCloud.info().user?.id || !FlowCloud.calendarToken()) return;
      // Eventos do UlbraFlow deste dono (inclusive órfãos ainda não removidos) nunca aparecem como externos.
      imported = events.filter(event => event.status !== 'cancelled' && event.start && event.end && !mine(event, owner));
      backoff.read = {failures: 0, until: 0};
    } catch (err) {
      if (request === generation) {
        readError = err.message;
        if (err.transient) armRead(postpone('read', err)); else imported = [];
      }
    } finally {
      if (request === generation) { reading = false; emit(); }
    }
  }
  const poll = () => { if (document.visibilityState === 'visible' && visibleRange && !reading && FlowCloud.calendarToken()) refresh(); };
  function stopPolling() { if (poller) clearInterval(poller); poller = null; clearTimeout(readTimer); readTimer = null; }
  // showRange(null) ao sair da Agenda: esquece a semana, descarta leituras pendentes e para a consulta a cada minuto.
  function showRange(start, end) {
    if (start == null) {
      if (visibleRange) { visibleRange = null; imported = []; reading = false; readError = ''; generation++; }
      stopPolling();
      return;
    }
    poller ||= setInterval(poll, 60000);
    if (visibleRange?.start === start && visibleRange?.end === end) return;
    visibleRange = {start, end}; imported = []; generation++;
    queueMicrotask(refresh);
  }
  async function hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  }
  const eventId = async (owner, taskId) => 'f10' + await hex(`flow:${owner}:${taskId}`);
  function eventBody(task, database, owner) {
    if (!FlowWorkflow.validDate(task.plannedDate)) throw failure('Informe uma data de execução válida.', {task: true});
    let start, end;
    if (task.plannedTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.plannedTime)) throw failure('Informe um horário de execução válido.', {task: true});
      const from = new Date(`${task.plannedDate}T${task.plannedTime}:00`);
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      start = {dateTime: from.toISOString(), timeZone: zone};
      end = {dateTime: new Date(from.getTime() + (database.preferences?.focusMinutes || 25)*60000).toISOString(), timeZone: zone};
    } else {
      const until = new Date(`${task.plannedDate}T12:00:00Z`);
      until.setUTCDate(until.getUTCDate() + 1);
      start = {date: task.plannedDate};
      end = {date: until.toISOString().slice(0, 10)};
    }
    const areas = [...(Array.isArray(database.projects) ? database.projects : []), ...(Array.isArray(database.archivedProjects) ? database.archivedProjects : [])];
    const area = areas.find(p => p?.id === task.project)?.name || 'Sem área';
    // Formato preservado: o hash deste corpo é comparado com o já sincronizado.
    return {summary: task.title, description: `Área: ${area}\nPrazo final: ${task.dueDate || 'Sem prazo'}\n${task.description || ''}`,
      start, end, visibility: 'private', extendedProperties: {private: {flowUserId: owner, flowTaskId: task.id}}};
  }
  const owned = (event, owner, taskId) => event?.extendedProperties?.private?.flowUserId === owner && event?.extendedProperties?.private?.flowTaskId === String(taskId);
  function records(db) {
    if (!isObject(db.calendar)) db.calendar = {events: {}};
    if (!isObject(db.calendar.events)) db.calendar.events = {};
    return db.calendar.events;
  }
  function inputSignature(){
    const db=workspace(),tasks=Array.isArray(db.tasks)?db.tasks:[];return JSON.stringify({owner:FlowCloud.info().user?.id,minutes:db.preferences?.focusMinutes||25,
      areas:[...(Array.isArray(db.projects)?db.projects:[]),...(Array.isArray(db.archivedProjects)?db.archivedProjects:[])].map(p=>[p?.id,p?.name]),
      tasks:tasks.filter(t=>t?.plannedDate).map(t=>[t.id,t.title,t.project,t.plannedDate,t.plannedTime,t.dueDate,t.description])});
  }
  // Remove only UlbraFlow-owned events; a cancelled one is already deleted.
  async function remove(db, owner, taskId) {
    const id = await eventId(owner, taskId);
    try {
      const event = await api('/' + id);
      if (event?.status !== 'cancelled' && owned(event, owner, taskId)) await api('/' + id, 'DELETE');
    } catch (err) { if (![404, 410].includes(err.status)) throw err; }
    delete records(db)[taskId];
    persist();
  }
  async function upsert(db, owner, task) {
    const events = records(db), key = String(task.id);
    const body = eventBody(task, db, owner), text = JSON.stringify(body);
    const prior = isObject(events[key]) && events[key].owner === owner ? events[key] : null;
    // Assinatura antiga guardava o JSON inteiro (duplicava descrições). Igual: troca pelo hash, sem reenviar.
    if (typeof prior?.signature === 'string' && prior.signature.startsWith('{') && prior.signature === text) {
      prior.signature = await hex(text); persist(); return;
    }
    const signature = await hex(text), id = await eventId(owner, task.id);
    if (prior?.signature === signature) return;
    // PUT envia o evento completo: sem mesclas parciais ao trocar dia inteiro ↔ horário, e reativa um evento cancelado.
    const payload = {...body, status: 'confirmed'};
    let event, written = false;
    if (prior?.id === id) {
      try { event = await api('/' + id, 'PUT', payload); written = true; }
      catch (err) { if (![404, 410].includes(err.status)) throw err; }
    }
    if (!written) {
      try { event = await api('', 'POST', {id, ...payload}); }
      catch (err) {
        if (err.status !== 409) throw err;
        // O Google reserva o id de um evento excluído: a leitura pode trazer só {id, status:'cancelled'}.
        // O id é SHA-256 de dono + tarefa, então um evento cancelado com ele é a cópia excluída desta tarefa.
        const existing = await api('/' + id);
        if (existing?.status !== 'cancelled' && !owned(existing, owner, task.id)) throw failure('O evento existente não pertence a esta tarefa do UlbraFlow.', {task: true});
        event = await api('/' + id, 'PUT', payload);
      }
    }
    // Keep the signature of the snapshot sent, even if the task changed during the request.
    events[key] = {owner, id, signature, url: event?.htmlLink || ''};
    persist();
  }
  // Os registros locais podem voltar a uma cópia antiga (backup restaurado, versão da nuvem) e esquecer eventos.
  // No máximo uma vez por hora (e na primeira sincronização da sessão), busca no Google os eventos deste dono e
  // remove os de tarefas inexistentes ou sem data de execução.
  async function sweep(db, owner) {
    if (swept.owner === owner && Date.now() - swept.at < SWEEP_MS) return;
    if (FlowCloud.info().status === 'conflict') return; // Cópia local divergente pode não ter tarefas de outro dispositivo.
    swept = {owner, at: Date.now()};
    const found = await list({privateExtendedProperty: `flowUserId=${owner}`, showDeleted: 'false', fields: 'items(id,status,updated,extendedProperties),nextPageToken'});
    const dated = new Set((Array.isArray(db.tasks) ? db.tasks : []).filter(t => t?.plannedDate && usable(t.id)).map(t => String(t.id)));
    for (const event of found) {
      const data = event?.extendedProperties?.private, taskId = data?.flowTaskId;
      if (event?.status === 'cancelled' || data?.flowUserId !== owner || typeof taskId !== 'string' || dated.has(taskId)) continue;
      // Evento gravado depois desta cópia ser carregada pode ser de tarefa criada em outro dispositivo: fica para depois.
      if (!(Date.parse(event.updated) < loadedAt - SWEEP_MARGIN_MS)) continue;
      if (event.id !== await eventId(owner, taskId)) continue;
      try { await api('/' + event.id, 'DELETE'); }
      catch (err) { if (![404, 410].includes(err.status)) { if (taskFailure(err)) continue; throw err; } }
      const events = records(db);
      if (Object.hasOwn(events, taskId)) { delete events[taskId]; persist(); }
    }
  }
  const summary = errors => `${errors.length === 1 ? '1 tarefa não foi sincronizada' : `${errors.length} tarefas não foram sincronizadas`} com o Google Agenda: ` +
    errors.slice(0, 3).map(item => `“${item.title || 'Sem título'}” (${item.message})`).join('; ') + (errors.length > 3 ? '; …' : '.');
  function arm(ms) { clearTimeout(timer); timer = setTimeout(() => { backoff.write.until = 0; synchronize().catch(() => {}); }, ms); }
  async function synchronize() {
    if (running) return running;
    if (!FlowCloud.calendarToken()) return;
    const wait = backoff.write.until - Date.now();
    if (wait > 0) { arm(wait); return; } // Respeita Retry-After; a nova tentativa já está agendada.
    clearTimeout(timer);
    const errors = [];
    running = (async () => {
      const signature=inputSignature();
      state('syncing');
      const db = workspace(), owner = FlowCloud.info().user?.id;
      if (!owner) throw new Error('Entre com Google no UlbraFlow para sincronizar a Agenda.');
      const tasks = Array.isArray(db.tasks) ? [...db.tasks] : [], events = records(db);
      const later = (a, b) => deferred.has(a) - deferred.has(b);
      // Cada tarefa é isolada: falhas próprias ficam registradas; limite, indisponibilidade e autorização interrompem a rodada.
      const step = async (key, title, work) => {
        try { await work(); deferred.delete(key); }
        catch (err) {
          if (!taskFailure(err)) { if (err.transient) deferred.add(key); throw err; }
          errors.push({taskId: key, title, message: err.message});
        }
      };
      const dated = new Set(tasks.filter(t => t?.plannedDate && usable(t.id)).map(t => String(t.id)));
      for (const taskId of Object.keys(events).sort(later)) {
        if (!dated.has(taskId)) await step(taskId, String(tasks.find(t => String(t?.id) === taskId)?.title ?? ''), () => remove(db, owner, taskId));
      }
      const pending = tasks.filter(t => t?.plannedDate).sort((a, b) => later(String(a.id), String(b.id)));
      for (const task of pending) {
        const title = String(task.title ?? '');
        if (!usable(task.id)) { errors.push({taskId: '', title, message: 'Tarefa sem identificador.'}); continue; }
        await step(String(task.id), title, () => upsert(db, owner, task));
      }
      await sweep(db, owner);
      backoff.write = {failures: 0, until: 0};
      taskErrors = errors;
      syncedInput=signature;
      if (errors.length) state('partial', summary(errors)); else state('synced');
      await refresh();
    })().catch(err => {
      taskErrors = errors;
      if (err.transient) arm(postpone('write', err));
      state('error', err.message); throw err;
    }).finally(() => { running = null;if(status==='synced'||status==='partial')schedule(); });
    return running;
  }
  function schedule() {
    if (!FlowCloud.calendarToken()) return;
    if ((status==='synced'||status==='partial')&&inputSignature()===syncedInput) { clearTimeout(timer); return; }
    const wait = backoff.write.until - Date.now();
    if (wait > 0) { arm(wait); return; }
    clearTimeout(timer);
    timer = setTimeout(() => synchronize().catch(() => {}), 900);
  }
  document.addEventListener('visibilitychange', poll);
  globalThis.FlowCalendar = {info, synchronize, schedule, showRange, refresh,
    initialize: (read, save) => { getDatabase = read; persist = save; workspace(); if (FlowCloud.calendarToken()) {status = 'connected'; schedule();} },
    connect: () => FlowCloud.signIn(true), disconnect: () => { clearTimeout(timer); stopPolling(); generation++; imported = []; reading = false; readError = ''; visibleRange = null; syncedInput=''; taskErrors = []; FlowCloud.disconnectCalendar(); state('disconnected'); }};
})();
