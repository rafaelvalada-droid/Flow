/* Regras de classificação e tempo. Sem dependência da interface ou de serviços. */
(() => {
  'use strict';
  const defaults = {focusMinutes: 25, breakMinutes: 5};
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && localDate(date) === value;
  }
  const minutes = (value, fallback, max) => {
    const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    return Number.isFinite(number) && number >= 1 && number <= max ? Math.round(number) : fallback;
  };
  const classified = (db, task) => [...db.projects,...(db.archivedProjects||[])].some(area => area.id === task.project) && validDate(task.dueDate);
  const stage = (db, task) => task.status === 'done' ? 'done' : !classified(db, task) ? 'inbox' : ['todo','doing','waiting'].includes(task.status) ? task.status : 'todo';
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.createdAt || 0) - (b.createdAt || 0);
  function urgency(task, today = localDate()) {
    if (task.status === 'done') return {label: 'Concluída', tone: 'quiet'};
    if (!validDate(task.dueDate)) return {label: 'Definir data', tone: 'quiet'};
    if (task.dueDate < today) return {label: 'Atrasada', tone: 'late'};
    if (task.dueDate === today) return {label: 'Hoje', tone: 'today'};
    const tomorrow = new Date(`${today}T12:00:00`); tomorrow.setDate(tomorrow.getDate()+1);
    if (task.dueDate === localDate(tomorrow)) return {label: 'Amanhã', tone: 'soon'};
    return {label: 'Programada', tone: 'quiet'};
  }
  function stopTask(task, now = Date.now()) {
    if (!task?.startedAt) return;
    if (!Array.isArray(task.sessions)) task.sessions = [];
    const latest = task.sessions.at(-1);
    if (latest && latest.start === task.startedAt && !latest.end) latest.end = Math.max(latest.start, now);
    else task.sessions.push({start: task.startedAt, end: Math.max(task.startedAt, now)});
    task.startedAt = null;
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  // Normalização total: dados malformados (backup antigo, nuvem, edição manual) nunca impedem a abertura.
  // Nada é descartado em silêncio; o que não pode ser usado fica em db.recovered. IDs e históricos válidos não mudam.
  function recover(db, record) {
    if (!Array.isArray(db.recovered)) db.recovered = db.recovered == null ? [] : [{from: 'recovered', value: db.recovered}];
    db.recovered.push(record);
  }
  function objects(db, owner, key, from, extra = {}) {
    const value = owner[key];
    if (Array.isArray(value)) {
      if (value.every(isObject)) return;
      value.forEach((item, index) => { if (!isObject(item)) recover(db, {from, ...extra, index, value: item}); });
      owner[key] = value.filter(isObject);
    } else {
      if (value != null) recover(db, {from, ...extra, value});
      owner[key] = [];
    }
  }
  function normalize(db, now = Date.now()) {
    if (!isObject(db)) db = db == null ? {} : {recovered: [{from: 'workspace', value: db}]};
    db.version ??= 1;
    globalThis.FlowAreas.migrate(db);
    objects(db, db, 'tasks', 'tasks');
    if (!isObject(db.preferences)) {
      if (db.preferences != null) recover(db, {from: 'preferences', value: db.preferences});
      db.preferences = {};
    }
    const preferences = db.preferences;
    preferences.focusMinutes = minutes(preferences.focusMinutes, defaults.focusMinutes, 180);
    preferences.breakMinutes = minutes(preferences.breakMinutes, defaults.breakMinutes, 60);
    const alerts = Array.isArray(preferences.alerts) ? preferences.alerts : [];
    preferences.alerts = [true,true,true,false].map((fallback, i) => typeof alerts[i] === 'boolean' ? alerts[i] : fallback);
    preferences.reminderDays = [1,2,3,7].includes(Number(preferences.reminderDays)) ? Number(preferences.reminderDays) : 1;
    if (db.focus != null && !isObject(db.focus)) { recover(db, {from: 'focus', value: db.focus}); db.focus = null; }
    for (const task of db.tasks) {
      objects(db, task, 'sessions', 'task.sessions', {taskId: task.id});
      objects(db, task, 'subtasks', 'task.subtasks', {taskId: task.id});
      if (task.description == null) task.description = '';
      else if (typeof task.description !== 'string') {
        if (typeof task.description === 'object') { recover(db, {from: 'task.description', taskId: task.id, value: task.description}); task.description = ''; }
        else task.description = String(task.description);
      }
      if (task.title != null && typeof task.title !== 'string' && typeof task.title !== 'object') task.title = String(task.title);
      const cycles = Math.floor(Number(task.focusCycles));
      task.focusCycles = Number.isFinite(cycles) && cycles > 0 ? cycles : 0;
      if (task.startedAt && !Number.isFinite(task.startedAt)) { recover(db, {from: 'task.startedAt', taskId: task.id, value: task.startedAt}); task.startedAt = null; }
    }
    // Cronômetro anterior ao Pomodoro (startedAt sem focus): o intervalo até a migração não é verificável
    // (aba esquecida, backup antigo importado meses depois) e ausência não conta como trabalho. Opção mais
    // segura: tratá-lo como um ciclo iniciado em startedAt, limitado a um foco. Dentro do ciclo, continua
    // ativo com o tempo restante; encerrado, a sessão termina no fim previsto e nada começa sem o usuário.
    if (!db.focus) {
      const durationMs = preferences.focusMinutes * 60000;
      for (const task of db.tasks.filter(task => task.startedAt)) {
        const endsAt = Math.min(task.startedAt, now) + durationMs;
        if (!db.focus && endsAt > now) db.focus = {taskId: task.id, phase: 'work', endsAt, remainingMs: endsAt - now, durationMs};
        else stopTask(task, Math.min(now, endsAt));
      }
    }
    return db;
  }
  function reconcile(db, now = Date.now()) {
    const focus = db.focus;
    if (!focus) return false;
    const task = db.tasks.find(t => t.id === focus.taskId);
    if (!task || task.status === 'done') {
      stopTask(task, Math.min(now, focus.endsAt || now)); db.focus = null; return true;
    }
    let changed = false;
    if (focus.phase === 'work' && focus.endsAt && now >= focus.endsAt) {
      const endedAt = focus.endsAt;
      stopTask(task, endedAt);
      task.focusCycles = (task.focusCycles || 0) + 1;
      focus.phase = 'break'; focus.durationMs = db.preferences.breakMinutes * 60000;
      focus.remainingMs = focus.durationMs; focus.endsAt = endedAt + focus.durationMs;
      changed = true;
    }
    if (focus.phase === 'break' && focus.endsAt && now >= focus.endsAt) {
      focus.phase = 'ready'; focus.endsAt = null; focus.remainingMs = 0; changed = true;
    }
    return changed;
  }
  function start(db, taskId, now = Date.now()) {
    reconcile(db, now);
    const task = db.tasks.find(t => t.id === taskId);
    if (!task || task.status === 'done' || !classified(db, task)) return false;
    const previous = db.focus;
    if (previous?.taskId === taskId && previous.phase === 'work' && previous.endsAt) return true;
    const remainingMs = previous?.taskId === taskId && previous.phase === 'work' ? previous.remainingMs : db.preferences.focusMinutes * 60000;
    db.tasks.filter(t => t.startedAt).forEach(t => stopTask(t, now));
    task.startedAt = now; task.sessions.push({start: now, end: null}); task.status = 'doing';
    db.focus = {taskId, phase: 'work', endsAt: now + remainingMs, remainingMs, durationMs: previous?.taskId === taskId && previous.phase === 'work' ? previous.durationMs : remainingMs};
    return true;
  }
  function pause(db, now = Date.now()) {
    reconcile(db, now);
    const focus = db.focus;
    if (!focus?.endsAt) return;
    focus.remainingMs = Math.max(0, focus.endsAt - now);
    if (focus.phase === 'work') stopTask(db.tasks.find(t => t.id === focus.taskId), now);
    focus.endsAt = null;
  }
  function resumeBreak(db, now = Date.now()) {
    if (db.focus?.phase === 'break' && !db.focus.endsAt) db.focus.endsAt = now + db.focus.remainingMs;
  }
  function cancel(db, taskId, now = Date.now()) {
    reconcile(db, now);
    stopTask(db.tasks.find(t => t.id === taskId), now);
    if (db.focus?.taskId === taskId) db.focus = null;
  }
  const remaining = (db, now = Date.now()) => db.focus ? Math.max(0, db.focus.endsAt ? db.focus.endsAt - now : db.focus.remainingMs) : db.preferences.focusMinutes * 60000;
  globalThis.FlowWorkflow = Object.freeze({defaults, localDate, validDate, classified, stage, byDue, urgency, normalize, reconcile, start, pause, resumeBreak, cancel, remaining});
})();
