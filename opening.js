/* Abertura UlbraFlow: decide antes da primeira pintura e não altera a inicialização do app. */
(() => {
 'use strict';
 const root = document.documentElement, KEY = 'flow.opening.v1', {search, hash} = location;
 const param = new URLSearchParams(search).get('abertura');
 const callback = /(?:^|[?&#])(?:shared|code|error|error_description|access_token)=/.test(search + hash) || hash.startsWith('#capture=');
 let seen = false;
 try { seen = sessionStorage.getItem(KEY) === '1'; } catch {}
 const show = param === '1' || (!navigator.webdriver && param !== '0' && !callback && !seen);
 const cleanUrl = () => {
  const url = new URL(location.href);
  if (!url.searchParams.has('abertura')) return;
  url.searchParams.delete('abertura');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch {}
 };
 if (!show) {
  document.addEventListener('DOMContentLoaded', () => { document.getElementById('flow-opening')?.remove(); cleanUrl(); }, {once: true});
  return;
 }
 root.classList.add('flow-opening');
 try { sessionStorage.setItem(KEY, '1'); } catch {}
 let overlay, cta, locked = [], leaving = false;

 function drawOrbit() {
  const svg = overlay.querySelector('.fo-dots'), dots = document.createDocumentFragment();
  for (let i = 0; i < 60; i++) {
   const angle = (i + .5) / 60 * Math.PI * 2, dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
   dot.setAttribute('cx', (100 + 84 * Math.sin(angle)).toFixed(2));
   dot.setAttribute('cy', (100 - 84 * Math.cos(angle)).toFixed(2));
   dot.setAttribute('r', (1 + 1.9 * (i / 59) ** 1.5).toFixed(2));
   dots.appendChild(dot);
  }
  svg.appendChild(dots);
 }
 function focusApp() {
  for (const selector of ['#google-login:not([hidden])', '#sidebar-nav button.active', '.brand']) {
   const target = document.querySelector(selector);
   if (!target?.getClientRects().length) continue;
   target.focus({preventScroll: true});
   if (document.activeElement === target) return;
  }
  if (overlay.contains(document.activeElement)) document.activeElement.blur();
 }
 function release() {
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('focusin', onFocus, true);
  for (const node of locked) node.inert = false;
  locked = [];
 }
 function finish() {
  overlay.remove();
  root.classList.remove('flow-opening');
  cleanUrl();
 }
 function close(quick) {
  if (leaving) return;
  leaving = true;
  release();
  focusApp();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  if (quick) { overlay.classList.add('is-leaving', 'is-quick'); setTimeout(finish, 260); return; }
  const box = overlay.querySelector('.fo-orbit').getBoundingClientRect(), w = innerWidth, h = innerHeight;
  let x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (!box.width || y < 0 || y > h) { x = w / 2; y = h / 2; }
  const ring = Math.max(box.width * .42, 24), far = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 40;
  Object.entries({'--fo-cx': x + 'px', '--fo-cy': y + 'px', '--fo-r0': ring * .9 + 'px', '--fo-r1': far + 'px', '--fo-s': (far / ring).toFixed(3)})
   .forEach(([name, value]) => overlay.style.setProperty(name, value));
  root.style.setProperty('--fo-ox', x + 'px');
  root.style.setProperty('--fo-oy', y + 'px');
  overlay.classList.add('is-leaving');
  root.classList.add('fo-arrive');
  setTimeout(finish, 980);
  setTimeout(() => { root.classList.remove('fo-arrive'); root.style.removeProperty('--fo-ox'); root.style.removeProperty('--fo-oy'); }, 1150);
 }
 function onKey(event) {
  const {key} = event;
  if (key === 'Enter' && event.target.closest?.('[data-fo-skip]')) return;
  if (key === 'Escape' || key === 'Enter') { event.preventDefault(); event.stopPropagation(); close(key === 'Escape'); return; }
  if (key !== 'Tab') return;
  const items = [...overlay.querySelectorAll('button')], index = items.indexOf(document.activeElement);
  event.preventDefault();
  items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
 }
 function onFocus(event) {
  if (!overlay.contains(event.target)) cta.focus({preventScroll: true});
 }
 function init() {
  overlay = document.getElementById('flow-opening');
  if (!overlay || getComputedStyle(overlay).display === 'none') { overlay?.remove(); root.classList.remove('flow-opening'); return; }
  try {
   overlay.removeAttribute('hidden');
   drawOrbit();
   cta = overlay.querySelector('[data-fo-enter]');
   locked = [...document.querySelectorAll('.app-shell,#modal-backdrop')].filter(node => !node.inert);
   for (const node of locked) node.inert = true;
   cta.addEventListener('click', () => close(false));
   overlay.querySelector('[data-fo-skip]').addEventListener('click', () => close(true));
   document.addEventListener('keydown', onKey, true);
   document.addEventListener('focusin', onFocus, true);
   cta.focus({preventScroll: true});
  } catch {
   release();
   overlay.remove();
   root.classList.remove('flow-opening');
  }
 }
 document.addEventListener('DOMContentLoaded', init, {once: true});
})();
