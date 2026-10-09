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
  const minutes = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= max ? Math.round(Number(value)) : fallback;
  const classified = (db, task) => db.projects.some(area => area.id === task.project) && validDate(task.dueDate);
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
    const latest = task.sessions.at(-1);
    if (latest && latest.start === task.startedAt && !latest.end) latest.end = Math.max(latest.start, now);
    else task.sessions.push({start: task.startedAt, end: Math.max(task.startedAt, now)});
    task.startedAt = null;
  }
  function normalize(db, now = Date.now()) {
    db.preferences ??= {};
    db.preferences.focusMinutes = minutes(db.preferences.focusMinutes, defaults.focusMinutes, 180);
    db.preferences.breakMinutes = minutes(db.preferences.breakMinutes, defaults.breakMinutes, 60);
    db.preferences.alerts ??= [true,true,true,false];
    db.preferences.reminderDays ??= 1;
    for (const task of db.tasks) {
      task.sessions ??= []; task.subtasks ??= []; task.description ??= '';
      task.focusCycles ??= 0;
    }
    // Uma sessão antiga continua sendo preservada; o primeiro ciclo novo começa agora.
    if (!db.focus) {
      const running = db.tasks.filter(task => task.startedAt);
      if (running.length) {
        const durationMs = db.preferences.focusMinutes * 60000;
        db.focus = {taskId: running[0].id, phase: 'work', endsAt: now + durationMs, remainingMs: durationMs, durationMs};
        running.slice(1).forEach(task => stopTask(task, now));
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
