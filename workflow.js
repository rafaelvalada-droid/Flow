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
  // Dia, ΔT e horário. O dia é a data de execução (em tarefas antigas, o prazo); o ΔT é a duração prevista em
  // minutos; o horário é reservado sozinho no primeiro espaço livre do dia e pode ser arrastado na aba Hoje.
  const DAY_START = 8 * 60;
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const toMinutes = value => validTime(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const clock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  const validDuration = value => Number.isInteger(value) && value >= 5 && value <= 720;
  const durationLabel = value => !validDuration(value) ? '' : value < 60 ? `${value} min` : `${Math.floor(value / 60)}h${value % 60 ? String(value % 60).padStart(2, '0') : ''}`;
  const dayOf = task => validDate(task?.plannedDate) ? task.plannedDate : validDate(task?.dueDate) ? task.dueDate : '';
  function slotOf(task) {
    const start = toMinutes(task?.plannedTime);
    return start === null || !validDuration(task.duration) ? null : {start, end: Math.min(1440, start + task.duration)};
  }
  // Primeiro espaço livre de `duration` minutos a partir de `from`; sem espaço depois, procura entre `earliest` e
  // `from`; sem espaço nenhum, aceita sobrepor em `from` (o usuário ajusta arrastando).
  function freeSlot(busy, duration, from = DAY_START, earliest = 0) {
    const fits = start => start + duration <= 1440 && busy.every(b => start >= b.end || start + duration <= b.start);
    const first = Math.min(1440, Math.ceil(from / 5) * 5), ends = busy.map(b => b.end);
    const after = [first, ...ends.filter(end => end > first)].sort((a, b) => a - b);
    const before = [earliest, ...ends.filter(end => end >= earliest && end < first)].sort((a, b) => a - b);
    return [...after, ...before].find(fits) ?? Math.max(0, Math.min(first, 1440 - duration));
  }
  // Horários ocupados no dia: tarefas abertas daquele dia e, no dia de hoje, as atrasadas, que aparecem junto.
  function busyOn(db, day, today, exceptId) {
    return db.tasks.filter(t => t.id !== exceptId && t.status !== 'done' && (dayOf(t) === day || (day === today && dayOf(t) && dayOf(t) < today))).map(slotOf).filter(Boolean);
  }
  function schedule(db, task, now = Date.now(), extra = []) {
    const day = dayOf(task);
    if (!day || !validDuration(task.duration)) { task.plannedTime = ''; return null; }
    const current = new Date(now), today = localDate(current), nowMinutes = current.getHours() * 60 + current.getMinutes();
    const busy = [...busyOn(db, day, today, task.id), ...extra];
    const start = day === today ? freeSlot(busy, task.duration, Math.max(nowMinutes, DAY_START), nowMinutes) : freeSlot(busy, task.duration);
    task.plannedTime = clock(start);
    return slotOf(task);
  }
  // Define dia e ΔT e reserva o horário. Sem dia, a tarefa volta para a Entrada. Dia sem ΔT é só a data da demanda
  // (prazo): não reserva horário nem cria evento no Google Agenda, que recebe apenas os horários reservados.
  // Com ΔT, o dia vira data de execução e o prazo nunca fica antes dele.
  // `busy` traz horários ocupados de fora do UlbraFlow (compromissos do Google Agenda daquele dia).
  function plan(db, task, {day = dayOf(task), duration = task.duration, now = Date.now(), busy = []} = {}) {
    const before = {day: dayOf(task), time: task.plannedTime};
    task.duration = validDuration(duration) ? duration : null;
    if (!validDate(day)) { task.plannedDate = ''; task.dueDate = ''; task.plannedTime = ''; return null; }
    if (!task.duration) { task.plannedDate = ''; task.plannedTime = ''; task.dueDate = day; return null; }
    task.plannedDate = day;
    if (!validDate(task.dueDate) || task.dueDate < day) task.dueDate = day;
    if (before.day === day && validTime(before.time)) return slotOf(task);
    return schedule(db, task, now, busy);
  }
  // Arrastar na linha do tempo: novo início (e ΔT) no dia indicado.
  function move(task, day, start, duration = task.duration) {
    if (!validDate(day) || !validDuration(duration)) return false;
    const begin = Math.max(0, Math.min(1440 - duration, Math.round(start / 5) * 5));
    task.duration = duration; task.plannedDate = day; task.plannedTime = clock(begin);
    if (!validDate(task.dueDate) || task.dueDate < day) task.dueDate = day;
    return true;
  }
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
      if (task.duration != null && !validDuration(task.duration)) { const value = Math.round(Number(task.duration)); task.duration = validDuration(value) ? value : null; }
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
  globalThis.FlowWorkflow = Object.freeze({defaults, localDate, validDate, classified, stage, byDue, urgency, normalize, reconcile, start, pause, resumeBreak, cancel, remaining,
    DAY_START, validTime, toMinutes, clock, validDuration, durationLabel, dayOf, slotOf, freeSlot, schedule, plan, move});
})();
