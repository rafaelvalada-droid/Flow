(() => {
  'use strict';
  const SESSION = 'flow.auth.session.v1', ACTIVE = 'flow.active-workspace.v1';
  const REQUIRED = 'flow.cloud-required.v1', PKCE = 'flow.auth.pkce.v1';
  let config, session, user, key = 'flow.workspace.v1', revision = 0;
  let pending = null, saved = '', timer, saving, refresh, conflict = false;
  let status = 'local', error = '';
  const json = value => { try { return JSON.parse(value); } catch { return null; } };
  const emit = () => window.dispatchEvent(new CustomEvent('flow:sync-status'));
  const setStatus = (next, message = '') => { status = next; error = message; emit(); };
  const remember = value => {
    session = {...value, project: config.url, expires_at: value.expires_at || Math.floor(Date.now()/1000) + value.expires_in};
    localStorage.setItem(SESSION, JSON.stringify(session));
  };
  async function request(path, options = {}, authenticated = true) {
    if (authenticated) await ensureToken();
    const headers = {apikey: config.key, ...options.headers};
    if (authenticated) headers.Authorization = `Bearer ${session.access_token}`;
    if (options.body) headers['content-type'] = 'application/json';
    const response = await fetch(config.url + path, {...options, headers, signal: AbortSignal.timeout(12000)});
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(response.status === 409 ? 'Outra aba ou dispositivo alterou seus dados. Exporte um backup e carregue a versão da nuvem.' :
        response.status === 401 ? 'Sua sessão expirou. Entre com Google novamente.' : 'Não foi possível acessar a nuvem. Verifique a conexão e a configuração do Supabase.');
      err.status = response.status;
      throw err;
    }
    return data;
  }
  async function ensureToken() {
    if (!session?.access_token) throw new Error('Entre com Google primeiro.');
    if (session.expires_at > Date.now()/1000 + 60) return;
    if (!refresh) {
      const renew = async () => {
        const latest = json(localStorage.getItem(SESSION));
        if (latest?.project === config.url && latest.user?.id === user?.id) session = latest;
        if (session.expires_at > Date.now()/1000 + 60) return;
        const old = session;
        const next = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: JSON.stringify({refresh_token: old.refresh_token})
        }, false);
        if (next?.user?.id !== old.user?.id) throw new Error('A sessão mudou. Entre novamente.');
        remember({...next, provider_token: old.provider_token, calendarConnected: old.calendarConnected});
      };
      refresh = (navigator.locks ? navigator.locks.request('flow-auth-refresh', renew) : renew()).finally(() => { refresh = null; });
    }
    await refresh;
  }
  async function signIn(calendar = false) {
    if (!config?.configured) throw new Error('Para ativar Entrar com Google, configure o projeto Supabase na Vercel. Consulte as instruções de ativação.');
    if (calendar && pending) await flush();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const base64url = data => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = base64url(bytes);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(PKCE, JSON.stringify({verifier, calendar, expectedUser: calendar ? user.id : null, createdAt: Date.now()}));
    const url = new URL(config.url + '/auth/v1/authorize');
    url.search = new URLSearchParams({provider: 'google', redirect_to: location.origin + location.pathname,
      code_challenge: challenge, code_challenge_method: 's256', prompt: calendar ? 'consent' : 'select_account',
      ...(calendar ? {scopes: 'https://www.googleapis.com/auth/calendar.events'} : {})});
    location.assign(url.href);
  }
  async function initialize() {
    // Fail closed when configuration or the remote workspace cannot be checked.
    const response = await fetch('/api/auth-config', {cache: 'no-store', signal: AbortSignal.timeout(12000)});
    config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Não foi possível verificar a configuração de acesso.');
    localStorage.removeItem(ACTIVE);
    if (!config.configured) {
      if (localStorage.getItem(REQUIRED)) throw new Error('O acesso Google precisa ser reativado na configuração da Vercel.');
      localStorage.setItem(ACTIVE, JSON.stringify({mode: 'local', key}));
      return {mode: 'local', key, data: null};
    }
    localStorage.setItem(REQUIRED, '1');
    session = json(localStorage.getItem(SESSION));
    if (session?.project !== config.url) session = null;
    const params = new URLSearchParams(location.search);
    if (params.has('error') || params.has('error_description')) {
      history.replaceState(null, '', location.pathname + location.hash);
      sessionStorage.removeItem(PKCE);
      throw new Error('O Google não autorizou o acesso. Tente entrar novamente.');
    }
    if (params.has('code')) {
      const proof = json(sessionStorage.getItem(PKCE));
      const code = params.get('code');
      history.replaceState(null, '', location.pathname + location.hash);
      sessionStorage.removeItem(PKCE);
      if (!proof?.verifier || Date.now() - proof.createdAt > 600000) throw new Error('A tentativa de login expirou. Clique em Entrar com Google novamente.');
      const next = await request('/auth/v1/token?grant_type=pkce', {
        method: 'POST', body: JSON.stringify({auth_code: code, code_verifier: proof.verifier})
      }, false);
      if (proof.expectedUser && next?.user?.id !== proof.expectedUser) throw new Error('Conecte a Agenda usando a mesma conta Google do Flow.');
      remember({...next, calendarConnected: !!(proof.calendar && next.provider_token)});
    }
    if (!session) return {mode: 'login'};
    // Use the verified user, never an email or user ID supplied by the browser.
    user = await request('/auth/v1/user');
    if (!/^[a-f0-9-]{36}$/i.test(user?.id || '') || session.user?.id !== user.id) throw new Error('Não foi possível verificar sua conta Google. Entre novamente.');
    key = `flow.workspace.v1:${user.id}`;
    const rows = await request(`/rest/v1/flow_workspaces?user_id=eq.${user.id}&select=data,revision`);
    const remote = rows?.[0];
    revision = remote?.revision || 0;
    saved = remote ? JSON.stringify(remote.data) : '';
    let data = remote?.data || null;
    if (localStorage.getItem(key + '.pending')) {
      const cached = json(localStorage.getItem(key));
      if (cached?.version === 1) {
        data = cached;
        if (Number(localStorage.getItem(key + '.revision')) !== revision) conflict = true;
        else pending = JSON.stringify(cached);
      }
    }
    if (!conflict) localStorage.setItem(key + '.revision', String(revision));
    localStorage.setItem(ACTIVE, JSON.stringify({mode: 'cloud', userId: user.id, key}));
    setStatus(conflict ? 'conflict' : pending ? 'pending' : 'saved', conflict ? 'Há alterações locais e uma versão nova na nuvem. Exporte um backup antes de carregar a nuvem.' : '');
    return {mode: 'cloud', key, data, user};
  }
  function queue(data) {
    if (!user) return;
    const serialized = JSON.stringify(data);
    if (serialized === saved && !pending) return;
    pending = serialized;
    localStorage.setItem(key + '.pending', '1');
    if (conflict) { setStatus('conflict', error); return; }
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), 500);
  }
  async function flush(data) {
    if (data) queue(data);
    clearTimeout(timer);
    if (conflict) throw new Error(error);
    if (saving) { await saving; return pending ? flush() : undefined; }
    if (!pending || !user) return;
    saving = (async () => {
      while (pending) {
        const snapshot = pending;
        setStatus('saving');
        const result = await request('/rest/v1/rpc/flow_save_workspace', {
          method: 'POST', body: JSON.stringify({workspace_data: JSON.parse(snapshot), expected_revision: revision})
        });
        if (!Number.isInteger(result?.revision)) throw new Error('Resposta inválida do armazenamento na nuvem.');
        revision = result.revision;
        localStorage.setItem(key + '.revision', String(revision));
        saved = snapshot;
        if (pending === snapshot) pending = null;
      }
      localStorage.removeItem(key + '.pending');
      setStatus('saved');
    })().catch(err => {
      conflict = err.status === 409;
      setStatus(conflict ? 'conflict' : 'error', err.message);
      throw err;
    }).finally(() => { saving = null; });
    return saving;
  }
  async function loadRemote() {
    if (saving) await saving.catch(() => {});
    clearTimeout(timer);
    const rows = await request(`/rest/v1/flow_workspaces?user_id=eq.${user.id}&select=data,revision`);
    const remote = rows?.[0];
    if (!remote) throw new Error('Nenhum workspace encontrado na nuvem.');
    localStorage.setItem(key + '.backup:' + Date.now(), localStorage.getItem(key) || '');
    localStorage.setItem(key, JSON.stringify(remote.data));
    localStorage.setItem(key + '.revision', String(remote.revision));
    localStorage.removeItem(key + '.pending');
    location.reload();
  }
  async function signOut() {
    if (pending) await flush().catch(() => {});
    await request('/auth/v1/logout?scope=local', {method: 'POST'}).catch(() => {});
    clearTimeout(timer);
    session = null; user = null; pending = null;
    localStorage.removeItem(SESSION);
    localStorage.removeItem(ACTIVE);
    location.reload();
  }
  // A logout or account change in another tab must hide this workspace immediately.
  window.addEventListener('storage', event => {
    if (event.key !== SESSION || !user) return;
    const next = json(event.newValue);
    if (!next || next.project !== config.url || next.user?.id !== user.id) {
      clearTimeout(timer); pending = null;
      document.querySelector('.app-shell').hidden = true;
      location.reload();
    } else session = next;
  });
  globalThis.FlowCloud = {initialize, signIn, signOut, queue, flush, loadRemote,
    info: () => ({mode: user ? 'cloud' : 'local', user, key, status, error, configured: !!config?.configured}),
    calendarToken: () => session?.calendarConnected ? session.provider_token : null,
    disconnectCalendar: () => { if (session) { remember({...session, provider_token: null, calendarConnected: false}); } }};
})();
