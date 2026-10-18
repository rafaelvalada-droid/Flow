// Dia, ΔT e horário: espaço livre do dia, atrasadas ocupando o dia de hoje, prazo nunca antes do dia e arraste.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../areas.js';
import '../workflow.js';

const w = globalThis.FlowWorkflow;
const at = (date, time) => new Date(`${date}T${time}:00`).getTime();
const task = (id, extra = {}) => ({id, title: id, project: 'a', status: 'todo', plannedDate: '', plannedTime: '', dueDate: '', duration: null, sessions: [], subtasks: [], ...extra});
const db = (...tasks) => w.normalize({version: 1, projects: [{id: 'a'}], tasks, preferences: {}}, at('2026-10-18', '10:00'));

test('day falls back to the legacy deadline; durations read as minutes or hours', () => {
  assert.equal(w.dayOf(task('x', {plannedDate: '2026-10-20', dueDate: '2026-10-25'})), '2026-10-20');
  assert.equal(w.dayOf(task('x', {dueDate: '2026-10-25'})), '2026-10-25');
  assert.equal(w.dayOf(task('x', {plannedDate: '2026-02-30'})), '');
  assert.deepEqual([30, 60, 90, 125, 0, 721, 7.5].map(w.durationLabel), ['30 min', '1h', '1h30', '2h05', '', '', '']);
  assert.deepEqual(w.slotOf(task('x', {plannedTime: '09:30', duration: 45})), {start: 570, end: 615});
  assert.equal(w.slotOf(task('x', {plannedTime: '9:30', duration: 45})), null);
  assert.equal(w.slotOf(task('x', {plannedTime: '09:30'})), null);
});

test('freeSlot packs after busy blocks, looks earlier only when allowed, and overlaps as a last resort', () => {
  const busy = [{start: 480, end: 540}, {start: 545, end: 600}];
  assert.equal(w.freeSlot([], 30), 480);
  assert.equal(w.freeSlot(busy, 30), 600);
  assert.equal(w.freeSlot(busy, 5), 540);
  assert.equal(w.freeSlot(busy, 30, 482), 600);
  assert.equal(w.freeSlot([{start: 0, end: 1440}], 30, 600), 600);
  assert.equal(w.freeSlot([{start: 480, end: 1440}], 60), 0);
  assert.equal(w.freeSlot([{start: 480, end: 1440}], 60, 480, 480), 480);
  assert.equal(w.freeSlot([], 60, 1430, 1430), 1380);
});

test('plan reserves the first free time of the day, after now when the day is today', () => {
  const morning = task('morning', {plannedDate: '2026-10-21', plannedTime: '08:00', duration: 60});
  const data = db(morning, task('new'), task('today'));
  const [, created, current] = data.tasks;
  assert.deepEqual(w.plan(data, created, {day: '2026-10-21', duration: 30, now: at('2026-10-18', '10:00')}), {start: 540, end: 570});
  assert.equal(created.plannedTime, '09:00'); assert.equal(created.dueDate, '2026-10-21');
  assert.deepEqual(w.plan(data, current, {day: '2026-10-18', duration: 45, now: at('2026-10-18', '10:07')}), {start: 610, end: 655});
  const early = task('early'); data.tasks.push(early);
  assert.equal(w.plan(data, early, {day: '2026-10-18', duration: 30, now: at('2026-10-18', '06:00')}).start, 480);
});

test('overdue blocks keep their time and occupy today, so a new task goes around them', () => {
  const late = task('late', {plannedDate: '2026-10-17', plannedTime: '11:00', duration: 60});
  const done = task('done', {plannedDate: '2026-10-18', plannedTime: '12:00', duration: 60, status: 'done'});
  const data = db(late, done, task('new'));
  assert.deepEqual(w.plan(data, data.tasks[2], {day: '2026-10-18', duration: 60, now: at('2026-10-18', '10:30')}), {start: 720, end: 780});
});

test('appointments from Google Agenda also count as busy time', () => {
  const data = db(task('x'));
  assert.deepEqual(w.plan(data, data.tasks[0], {day: '2026-10-21', duration: 30, busy: [{start: 480, end: 600}], now: at('2026-10-18', '10:00')}), {start: 600, end: 630});
});

test('plan keeps a reservation when only the duration changes, and moves it with the day', () => {
  const data = db(task('x', {plannedDate: '2026-10-21', plannedTime: '14:00', duration: 30, dueDate: '2026-10-30'}));
  const [x] = data.tasks;
  w.plan(data, x, {duration: 90, now: at('2026-10-18', '10:00')});
  assert.deepEqual([x.plannedTime, x.duration, x.dueDate], ['14:00', 90, '2026-10-30']);
  w.plan(data, x, {day: '2026-10-22', now: at('2026-10-18', '10:00')});
  assert.deepEqual([x.plannedDate, x.plannedTime, x.dueDate], ['2026-10-22', '08:00', '2026-10-30']);
  w.plan(data, x, {day: '2026-11-02', now: at('2026-10-18', '10:00')});
  assert.equal(x.dueDate, '2026-11-02');
  w.plan(data, x, {duration: null});
  assert.deepEqual([x.plannedDate, x.plannedTime, x.duration, x.dueDate, w.dayOf(x)], ['', '', null, '2026-11-02', '2026-11-02']);
  w.plan(data, x, {day: ''});
  assert.deepEqual([x.plannedDate, x.dueDate, w.dayOf(x)], ['', '', '']);
});

test('a day without ΔT is just the date of the demand: no reserved time and no Google Agenda event', () => {
  const data = db(task('x', {dueDate: '2026-10-30'}));
  const [x] = data.tasks;
  assert.equal(w.plan(data, x, {day: '2026-10-21', now: at('2026-10-18', '10:00')}), null);
  assert.deepEqual([x.plannedDate, x.plannedTime, x.dueDate, w.dayOf(x)], ['', '', '2026-10-21', '2026-10-21']);
  w.plan(data, x, {duration: 60, now: at('2026-10-18', '10:00')});
  assert.deepEqual([x.plannedDate, x.plannedTime, x.dueDate], ['2026-10-21', '08:00', '2026-10-21']);
});

test('move snaps to 5 minutes, stays inside the day and moves an overdue task to the new day', () => {
  const x = task('x', {plannedDate: '2026-10-17', plannedTime: '11:00', duration: 60, dueDate: '2026-10-17'});
  assert.equal(w.move(x, '2026-10-18', 9 * 60 + 7), true);
  assert.deepEqual([x.plannedDate, x.plannedTime, x.dueDate], ['2026-10-18', '09:05', '2026-10-18']);
  w.move(x, '2026-10-18', 1430, 30);
  assert.equal(x.plannedTime, '23:30');
  w.move(x, '2026-10-18', -40);
  assert.equal(x.plannedTime, '00:00');
  assert.equal(w.move(x, '2026-10-18', 600, 0), false);
});

test('normalize keeps valid durations, rounds numeric strings and drops nonsense', () => {
  const data = db(task('a', {duration: 30}), task('b', {duration: '45'}), task('c', {duration: 'meia hora'}), task('d', {duration: 99999}), task('e'));
  assert.deepEqual(data.tasks.map(t => t.duration), [30, 45, null, null, null]);
});
