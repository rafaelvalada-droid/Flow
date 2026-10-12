(() => {
  'use strict';
  let getDatabase, persist, timer, running, status = 'disconnected', error = '';
  let visibleRange = null, imported = [], reading = false, readError = '', generation = 0, syncedInput='';
  const info = () => ({connected: !!FlowCloud.calendarToken(), status, error, reading, readError, events: FlowCloud.calendarToken() ? imported : []});
  const emit = () => window.dispatchEvent(new CustomEvent('flow:calendar-status'));
  const state = (next, message = '') => { status = next; error = message; emit(); };
  async function api(path = '', method = 'GET', body) {
    const token = FlowCloud.calendarToken();
    if (!token) throw new Error('Conecte sua conta ao Google Agenda.');
    const url='https://www.googleapis.com/calendar/v3/calendars/primary/events'+path;
    const options={
      method, headers: {Authorization: `Bearer ${token}`, ...(body ? {'content-type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(12000)
    };
    const response=FlowCloud.googleFetch?await FlowCloud.googleFetch('calendar',url,options):await fetch(url,options);
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 401) {
      FlowCloud.disconnectCalendar();
      throw new Error('Autorize o Google Agenda novamente. Confira também se a API Google Calendar está ativada.');
    }
    if(response.status===403){
      const reasons=[...(data?.error?.errors||[]),...(data?.error?.details||[])].map(item=>item.reason);
      if(reasons.some(reason=>['insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))){FlowCloud.disconnectCalendar();throw new Error('Conecte o Google Agenda novamente e autorize a permissão da Agenda.');}
      throw new Error(reasons.some(reason=>['SERVICE_DISABLED','accessNotConfigured','API_DISABLED'].includes(reason))?'Ative a Google Calendar API no projeto da conexão Google. Sua conexão foi mantida.':'O Google bloqueou o acesso à Agenda. Confira as regras da conta; sua conexão foi mantida.');
    }
    if (!response.ok) {
      const err = new Error('Não foi possível sincronizar com o Google Agenda. Tente novamente.');
      err.status = response.status;
      throw err;
    }
    return data;
  }
  async function refresh() {
    if (!visibleRange || !FlowCloud.calendarToken()) return;
    const request = ++generation, range = {...visibleRange};
    const owner = FlowCloud.info().user?.id;
    reading = true; readError = ''; emit();
    try {
      const events = [], pages = new Set();
      let next;
      do {
        const query = new URLSearchParams({timeMin: range.start, timeMax: range.end,
          singleEvents: 'true', orderBy: 'startTime', maxResults: '250'});
        if (next) query.set('pageToken', next);
        const response = await api('?' + query);
        events.push(...(response?.items || []));
        next = response?.nextPageToken;
        if (next && pages.has(next)) throw new Error('Não foi possível carregar todos os compromissos. Tente novamente.');
        if (next) pages.add(next);
      } while (next);
      if (request !== generation || owner !== FlowCloud.info().user?.id || !FlowCloud.calendarToken()) return;
      const tasks = getDatabase().tasks;
      imported = events.filter(event => event.status !== 'cancelled' && event.start && event.end &&
        !(event.extendedProperties?.private?.flowUserId === owner &&
          tasks.some(task => task.id === event.extendedProperties.private.flowTaskId && task.plannedDate)));
    } catch (err) {
      if (request === generation) { imported = []; readError = err.message; }
    } finally {
      if (request === generation) { reading = false; emit(); }
    }
  }
  function showRange(start, end) {
    if (visibleRange?.start === start && visibleRange?.end === end) return;
    visibleRange = {start, end}; imported = []; generation++;
    queueMicrotask(refresh);
  }
  async function eventId(owner, taskId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`flow:${owner}:${taskId}`));
    return 'f10' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  }
  function eventBody(task, database, owner) {
    if (!FlowWorkflow.validDate(task.plannedDate)) throw new Error('Informe uma data de execução válida.');
    let start, end;
    if (task.plannedTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(task.plannedTime)) throw new Error('Informe um horário de execução válido.');
      const from = new Date(`${task.plannedDate}T${task.plannedTime}:00`);
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      start = {dateTime: from.toISOString(), timeZone: zone};
      end = {dateTime: new Date(from.getTime() + (database.preferences.focusMinutes || 25)*60000).toISOString(), timeZone: zone};
    } else {
      const until = new Date(`${task.plannedDate}T12:00:00Z`);
      until.setUTCDate(until.getUTCDate() + 1);
      start = {date: task.plannedDate};
      end = {date: until.toISOString().slice(0, 10)};
    }
    const area = [...database.projects, ...(database.archivedProjects || [])].find(p => p.id === task.project)?.name || 'Sem área';
    return {summary: task.title, description: `Área: ${area}\nPrazo final: ${task.dueDate || 'Sem prazo'}\n${task.description || ''}`,
      start, end, visibility: 'private', extendedProperties: {private: {flowUserId: owner, flowTaskId: task.id}}};
  }
  const owned = (event, owner, taskId) => event?.extendedProperties?.private?.flowUserId === owner && event?.extendedProperties?.private?.flowTaskId === taskId;
  function inputSignature(){
    const db=getDatabase();return JSON.stringify({owner:FlowCloud.info().user?.id,minutes:db.preferences?.focusMinutes||25,
      areas:[...(db.projects||[]),...(db.archivedProjects||[])].map(p=>[p.id,p.name]),
      tasks:db.tasks.filter(t=>t.plannedDate).map(t=>[t.id,t.title,t.project,t.plannedDate,t.plannedTime,t.dueDate,t.description])});
  }
  async function synchronize() {
    clearTimeout(timer);
    if (running) return running;
    if (!FlowCloud.calendarToken()) return;
    running = (async () => {
      const signature=inputSignature();
      state('syncing');
      const db = getDatabase(), owner = FlowCloud.info().user.id;
      db.calendar ||= {events: {}};
      db.calendar.events ||= {};
      // Remove only Ulbraflow-owned events that no longer have an execution date.
      for (const taskId of Object.keys(db.calendar.events)) {
        if (db.tasks.some(t => t.id === taskId && t.plannedDate)) continue;
        const id = await eventId(owner, taskId);
        try {
          const event = await api('/' + id);
          if (owned(event, owner, taskId)) await api('/' + id, 'DELETE');
        } catch (err) { if (![404, 410].includes(err.status)) throw err; }
        delete db.calendar.events[taskId];
        persist();
      }
      for (const task of [...db.tasks].filter(t => t.plannedDate)) {
        const body = eventBody(task, db, owner), signature = JSON.stringify(body);
        const prior = db.calendar.events[task.id];
        if (prior?.owner === owner && prior.signature === signature) continue;
        const id = await eventId(owner, task.id);
        let event;
        try { event = await api('', 'POST', {id, ...body}); }
        catch (err) {
          if (err.status !== 409) throw err;
          const existing = await api('/' + id);
          if (!owned(existing, owner, task.id)) throw new Error('O evento existente não pertence a esta tarefa do Ulbraflow.');
          event = await api('/' + id, 'PATCH', body);
        }
        // Keep the signature of the snapshot sent, even if the task changed during the request.
        db.calendar.events[task.id] = {owner, id, signature, url: event?.htmlLink || ''};
        persist();
      }
      syncedInput=signature;state('synced');
      await refresh();
    })().catch(err => { state('error', err.message); throw err; }).finally(() => { running = null;if(status==='synced')schedule(); });
    return running;
  }
  function schedule() {
    if (!FlowCloud.calendarToken()||(status==='synced'&&inputSignature()===syncedInput)) return;
    clearTimeout(timer);
    timer = setTimeout(() => synchronize().catch(() => {}), 900);
  }
  setInterval(() => { if (document.visibilityState === 'visible' && visibleRange && !reading && FlowCloud.calendarToken()) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && visibleRange && !reading && FlowCloud.calendarToken()) refresh(); });
  globalThis.FlowCalendar = {info, synchronize, schedule, showRange, refresh,
    initialize: (read, save) => { getDatabase = read; persist = save; if (FlowCloud.calendarToken()) {status = 'connected'; schedule();} },
    connect: () => FlowCloud.signIn(true), disconnect: () => { clearTimeout(timer); generation++; imported = []; reading = false; readError = ''; visibleRange = null; syncedInput='';FlowCloud.disconnectCalendar(); state('disconnected'); }};
})();
