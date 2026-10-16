(() => {
  'use strict';
  const SESSION = 'flow.auth.session.v1', ACTIVE = 'flow.active-workspace.v1';
  // An open shell is not proof that this account has finished authentication.
  localStorage.removeItem(ACTIVE);
  const REQUIRED = 'flow.cloud-required.v1', PKCE = 'flow.auth.pkce.v1';
  const MAX_BYTES = 2000000, LIMIT = 'O workspace passou do limite de 2 MB da nuvem. Exporte um backup e libere espaço (por exemplo, esvazie a lixeira de projetos ou exclua tarefas concluídas antigas). As alterações continuam guardadas neste navegador.';
  const CONFLICT = 'Outra aba ou dispositivo alterou seus dados. Exporte um backup e carregue a versão da nuvem.';
  let config, session, user, key = 'flow.workspace.v1', revision = 0;
  // saved = último conteúdo confirmado na nuvem; é a base da mesclagem automática.
  let pending = null, saved = '', timer, saving, refresh, conflict = false;
  let googleRefresh;
  let status = 'local', error = '';
  const json = value => { try { return JSON.parse(value); } catch { return null; } };
  const emit = () => window.dispatchEvent(new CustomEvent('flow:sync-status'));
  const setStatus = (next, message = '') => { status = next; error = message; emit(); };
  // Com o armazenamento do navegador cheio, gravações auxiliares falham sem impedir o envio para a nuvem.
  const store = (name, value) => { try { localStorage.setItem(name, value); return true; } catch { return false; } };
  const remember = value => {
    session = {...value, project: config.url, expires_at: value.expires_at || Math.floor(Date.now()/1000) + value.expires_in};
    store(SESSION, JSON.stringify(session));
  };
  const bytes = text => globalThis.TextEncoder ? new TextEncoder().encode(text).length : text.length;
  function failure(status, data, path) {
    const code = String(data?.code || data?.error_code || data?.error || ''), detail = String(data?.message || data?.msg || data?.error_description || '');
    if (status === 409) return CONFLICT;
    if (status === 413 || code === '22023' || /maximum 2 MB/i.test(detail)) return LIMIT;
    if (path.startsWith('/auth/v1/token') && (status === 400 || status === 401 || /invalid_grant|refresh_token/i.test(code)))
      return path.includes('grant_type=pkce') ? 'A tentativa de login expirou ou já foi usada. Clique em Entrar com Google novamente.' : 'Sua sessão expirou. Entre novamente.';
    if (status === 401) return 'Sua sessão expirou. Entre com Google novamente.';
    if (status >= 500) return `O Supabase está temporariamente indisponível (HTTP ${status}). Tente novamente em instantes.`;
    return 'Não foi possível acessar a nuvem. Verifique a conexão e a configuração do Supabase.';
  }
  async function request(path, options = {}, authenticated = true) {
    if (authenticated) await ensureToken();
    const {timeout = 12000, ...init} = options;
    const headers = {apikey: config.key, ...init.headers};
    if (authenticated) headers.Authorization = `Bearer ${session.access_token}`;
    if (init.body) headers['content-type'] = 'application/json';
    let response;
    try { response = await fetch(config.url + path, {...init, headers, signal: AbortSignal.timeout(timeout)}); }
    catch (cause) {
      const err = new Error(cause?.name === 'TimeoutError' ? 'A nuvem demorou para responder. Verifique a conexão e tente novamente.' : 'Não foi possível acessar a nuvem. Verifique a conexão e a configuração do Supabase.');
      err.network = true;
      throw err;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(failure(response.status, data, path));
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
        const current=session?.user?.id===old.user.id?session:old;
        remember({...next, provider_token:current.provider_token,provider_refresh_token:current.provider_refresh_token,google_access_expires_at:current.google_access_expires_at,calendarConnected:current.calendarConnected,gmailConnected:current.gmailConnected});
      };
      refresh = (navigator.locks ? navigator.locks.request('flow-auth-refresh', renew) : renew()).finally(() => { refresh = null; });
    }
    await refresh;
  }
  // Revogação no Google é melhor esforço: a resposta é opaca (no-cors) e falhas não bloqueiam a interface.
  const revokeGoogle = tokens => { for (const token of new Set(tokens.filter(value => typeof value === 'string' && value))) try { fetch('https://oauth2.googleapis.com/revoke', {method: 'POST', mode: 'no-cors', keepalive: true, body: new URLSearchParams({token})}).catch(() => {}); } catch {} };
  // Sem Gmail nem Agenda, os tokens Google saem do navegador e a autorização é revogada.
  function withoutGoogle(value) {
    revokeGoogle([value.provider_refresh_token, value.provider_token]);
    const {provider_token, provider_refresh_token, google_access_expires_at, ...rest} = value;
    return {...rest, gmailConnected: false, calendarConnected: false};
  }
  function disconnect(flag, extra = {}) {
    if (!session) return;
    const next = {...session, ...extra, [flag]: false};
    remember(next.gmailConnected || next.calendarConnected ? next : withoutGoogle(next));
  }
  async function signIn(calendar = false) {
    const gmail=calendar==='gmail';
    const includeCalendar=calendar===true||!!session?.calendarConnected;
    const includeGmail=gmail||!!session?.gmailConnected;
    if (!config?.configured) throw new Error('Para ativar Entrar com Google, configure o projeto Supabase na Vercel. Consulte as instruções de ativação.');
    if (calendar && pending) await flush();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const base64url = data => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = base64url(bytes);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(PKCE, JSON.stringify({verifier, calendar:includeCalendar,gmail:includeGmail, expectedUser: calendar ? user.id : null, createdAt: Date.now()}));
    const url = new URL(config.url + '/auth/v1/authorize');
    url.search = new URLSearchParams({provider: 'google', redirect_to: location.origin + location.pathname,
      code_challenge: challenge, code_challenge_method: 's256',access_type:'offline',include_granted_scopes:'true',
      prompt:!session?.provider_refresh_token||calendar&&!session?.[gmail?'gmailConnected':'calendarConnected']?'consent':'select_account',
      ...(includeCalendar||includeGmail ? {scopes:[...(includeCalendar?['https://www.googleapis.com/auth/calendar.events']:[]),...(includeGmail?['https://www.googleapis.com/auth/gmail.modify']:[])].join(' ')} : {})});
    location.assign(url.href);
  }
  // Mantém só a cópia de segurança mais nova desta conta; cópias antigas esgotavam a cota do navegador.
  function pruneBackups(keep) {
    try {
      const prefix = key + '.backup:', found = [];
      for (let i = 0; i < localStorage.length; i++) { const name = localStorage.key(i); if (name?.startsWith(prefix)) found.push(name); }
      found.sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length))).slice(keep).forEach(name => localStorage.removeItem(name));
    } catch {}
  }
  async function initialize() {
    let resumePage=null;
    // Fail closed when configuration or the remote workspace cannot be checked.
    const response = await fetch('/api/auth-config', {signal: AbortSignal.timeout(12000)});
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
      if (proof.expectedUser && next?.user?.id !== proof.expectedUser) throw new Error('Conecte a Agenda usando a mesma conta Google do UlbraFlow.');
      if(proof.gmail)resumePage='entrada';
      const previous=session?.user?.id===next.user?.id?session:null;
      // Tokens Google só ficam guardados quando Gmail ou Agenda foram autorizados nesta tentativa.
      remember(next.provider_token&&(proof.calendar||proof.gmail)?{...next,provider_refresh_token:next.provider_refresh_token||previous?.provider_refresh_token||null,
        google_access_expires_at:Math.floor(Date.now()/1000)+3500,calendarConnected:!!proof.calendar,gmailConnected:!!proof.gmail}:
        (({provider_token,provider_refresh_token,...rest})=>({...rest,calendarConnected:false,gmailConnected:false}))(next));
    }
    if (!session) return {mode: 'login'};
    const claimed = session.user?.id;
    if (!/^[a-f0-9-]{36}$/i.test(claimed || '')) throw new Error('Não foi possível verificar sua conta Google. Entre novamente.');
    // Conta e workspace em paralelo: a RLS limita a leitura ao dono do token e nada é usado antes da verificação abaixo.
    const [checked, loaded] = await Promise.allSettled([request('/auth/v1/user'), request(`/rest/v1/flow_workspaces?user_id=eq.${claimed}&select=data,revision`)]);
    if (checked.status === 'rejected') throw checked.reason;
    // Use the verified user, never an email or user ID supplied by the browser.
    user = checked.value;
    if (!/^[a-f0-9-]{36}$/i.test(user?.id || '') || session.user?.id !== user.id) { user = null; throw new Error('Não foi possível verificar sua conta Google. Entre novamente.'); }
    key = `flow.workspace.v1:${user.id}`;
    if (loaded.status === 'rejected') throw loaded.reason;
    pruneBackups(1);
    const remote = loaded.value?.[0];
    revision = remote?.revision || 0;
    saved = remote ? JSON.stringify(remote.data) : '';
    let data = remote?.data || null;
    if (localStorage.getItem(key + '.pending')) {
      const cached = json(localStorage.getItem(key));
      if (cached?.version === 1) {
        data = cached;
        if (Number(localStorage.getItem(key + '.revision')) !== revision) {
          // Alterações não enviadas e outro aparelho salvou depois: com a base guardada, mescla como num 409.
          const baseText = localStorage.getItem(key + '.base');
          const result = remote && baseText !== null ? merge(baseText ? json(baseText) : undefined, cached, remote.data) : null;
          if (result && !result.conflicts.length) {
            data = result.value;
            const text = JSON.stringify(data);
            pending = text === saved ? null : text;
            store(key, text);
            if (!pending) try { localStorage.removeItem(key + '.pending'); } catch {}
          } else conflict = true;
        } else pending = JSON.stringify(cached);
      }
    }
    if (!conflict) store(key + '.revision', String(revision));
    keepBase();
    store(ACTIVE, JSON.stringify({mode: 'cloud', userId: user.id, key}));
    setStatus(conflict ? 'conflict' : pending ? 'pending' : 'saved', conflict ? 'Há alterações locais e uma versão nova na nuvem. Exporte um backup antes de carregar a nuvem.' : '');
    // O que ficou pendente na sessão anterior (aba fechada logo após editar) é enviado agora, sem esperar outra edição.
    if (pending && !conflict) schedule();
    return {mode: 'cloud', key, data, user,resumePage};
  }

  // Mesclagem em três vias: base = último conteúdo confirmado na nuvem, local = pendente, remote = linha atual.
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (object, name) => Object.hasOwn(object, name) ? object[name] : undefined;
  const put = (object, name, value) => Object.defineProperty(object, name, {value, enumerable: true, writable: true, configurable: true});
  function same(a, b) {
    if (a === b) return true;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]));
    if (!plain(a) || !plain(b)) return false;
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every(name => Object.hasOwn(b, name) && same(a[name], b[name]));
  }
  const keyed = list => list.every(item => plain(item) && ['string', 'number'].includes(typeof item.id)) && new Set(list.map(item => item.id)).size === list.length;
  function merge3(base, local, remote, path, conflicts) {
    if (same(local, remote)) return local;
    if (same(base, local)) return remote;
    if (same(base, remote)) return local;
    if (plain(local) && plain(remote) && (base === undefined || plain(base))) {
      const out = {}, from = base || {};
      for (const name of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(from)])) {
        const value = merge3(own(from, name), own(local, name), own(remote, name), path + '/' + name, conflicts);
        if (value !== undefined) put(out, name, value);
      }
      return out;
    }
    if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base)) && keyed(local) && keyed(remote) && keyed(base || [])) {
      // Itens com id: mescla por id; exclusão de um lado só vale se o outro não alterou o item.
      const index = list => new Map(list.map(item => [item.id, item])), B = index(base || []), L = index(local), R = index(remote);
      const order = list => list.map(item => item.id).filter(id => B.has(id) && L.has(id) && R.has(id));
      // Ordem remota, salvo quando só esta aba reordenou os itens em comum.
      const localFirst = same(order(remote), order(base || [])) && !same(order(local), order(base || []));
      const [first, second] = localFirst ? [local, remote] : [remote, local], out = [], seen = new Set(), kept = new Set();
      const resolve = id => { seen.add(id); const value = merge3(B.get(id), L.get(id), R.get(id), path + '/' + id, conflicts); if (value !== undefined) kept.add(id); return value; };
      for (const item of first) { const value = resolve(item.id); if (value !== undefined) out.push(value); }
      // Novos itens do outro lado entram depois do vizinho anterior daquele lado (no início, se não houver).
      let previous = null;
      for (const item of second) {
        if (seen.has(item.id)) { if (kept.has(item.id)) previous = item.id; continue; }
        const value = resolve(item.id);
        if (value === undefined) continue;
        out.splice(previous === null ? 0 : out.findIndex(entry => entry.id === previous) + 1, 0, value);
        previous = item.id;
      }
      return out;
    }
    // Análises do Gmail e eventos da Agenda são refeitos por qualquer aparelho: vale a nuvem, sem travar a sincronização.
    if (/^\/(gmailReviews|calendar)\//.test(path)) return remote;
    conflicts.push(path || '/');
    return remote;
  }
  function merge(base, local, remote) { const conflicts = []; const value = merge3(base, local, remote, '', conflicts); return {value, conflicts}; }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (!saving) flush().catch(() => {}); }, 500); };
  // Enquanto há alterações não enviadas, a base (último conteúdo confirmado na nuvem) fica guardada para mesclar depois de recarregar.
  function keepBase() {
    if (pending && !conflict) store(key + '.base', saved);
    else if (!localStorage.getItem(key + '.pending')) try { localStorage.removeItem(key + '.base'); } catch {}
  }
  function queue(data, serialized = JSON.stringify(data)) {
    if (!user) return;
    if ((serialized === saved && !pending)||serialized===pending) return;
    const first = !pending;
    pending = serialized;
    if (first && !conflict) store(key + '.base', saved);
    store(key + '.pending', '1');
    if (conflict) { setStatus('conflict', error); return; }
    setStatus('pending');
    schedule();
  }
  const commit = (next, snapshot) => {
    revision = next;
    store(key + '.revision', String(revision));
    saved = snapshot;
    if (pending === snapshot) pending = null;
    if (pending) store(key + '.base', saved); else try { localStorage.removeItem(key + '.base'); } catch {}
  };
  // 409: a resposta pode ter se perdido depois do commit, ou outra aba/dispositivo salvou antes.
  async function settle(snapshot) {
    const remote = (await request(`/rest/v1/flow_workspaces?user_id=eq.${user.id}&select=data,revision`))?.[0];
    if (!remote || !Number.isInteger(remote.revision) || remote.revision < revision) return false;
    if (same(remote.data, JSON.parse(snapshot))) { commit(remote.revision, snapshot); return true; }
    if (!saved) return false;
    // A interface grava agora o que ainda está só na memória, para que entre na mesclagem.
    window.dispatchEvent(new CustomEvent('flow:persist-flush'));
    const local = JSON.parse(pending || snapshot), result = merge(JSON.parse(saved), local, remote.data);
    if (result.conflicts.length) return false;
    const merged = JSON.stringify(result.value), remoteText = JSON.stringify(remote.data);
    commit(remote.revision, remoteText);
    pending = merged === remoteText ? null : merged;
    store(key, merged);
    // A interface troca o workspace em memória pelo mesclado; sem isso, a próxima gravação perderia o que veio da nuvem.
    window.dispatchEvent(new CustomEvent('flow:cloud-remote-merged', {detail: {data: result.value}}));
    return true;
  }
  async function upload() {
    for (let attempt = 0; pending; attempt++) {
      const snapshot = pending, size = bytes(snapshot);
      if (size > MAX_BYTES) { const err = new Error(LIMIT); err.status = 413; throw err; }
      setStatus('saving');
      let result;
      try {
        // O tempo limite cresce com o tamanho: 15 s + 10 s a cada 500 KB, até 60 s.
        result = await request('/rest/v1/rpc/flow_save_workspace', {
          method: 'POST', body: `{"workspace_data":${snapshot},"expected_revision":${revision}}`, timeout: Math.min(60000, 15000 + Math.round(size / 500000 * 10000))
        });
      } catch (err) {
        if (err.status !== 409 || attempt > 2 || !await settle(snapshot)) throw err;
        continue;
      }
      if (!Number.isInteger(result?.revision)) throw new Error('Resposta inválida do armazenamento na nuvem.');
      commit(result.revision, snapshot);
      break;
    }
    // Edições feitas durante o envio voltam ao intervalo de 500 ms em vez de reenviar o workspace na hora.
    if (pending) { setStatus('pending'); schedule(); return; }
    try { localStorage.removeItem(key + '.pending'); } catch {}
    setStatus('saved');
  }
  async function flush(data) {
    if (data) queue(data);
    clearTimeout(timer);
    if (conflict) throw new Error(error);
    if (saving) { await saving; return pending ? flush() : undefined; }
    if (!pending || !user) return;
    saving = upload().catch(err => {
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
    pruneBackups(0);
    localStorage.setItem(key + '.backup:' + Date.now(), localStorage.getItem(key) || '');
    localStorage.setItem(key, JSON.stringify(remote.data));
    localStorage.setItem(key + '.revision', String(remote.revision));
    localStorage.removeItem(key + '.pending');
    localStorage.removeItem(key + '.base');
    location.reload();
  }
  async function signOut() {
    if (pending) await flush().catch(() => {});
    revokeGoogle([session?.provider_refresh_token, session?.provider_token]);
    await request('/auth/v1/logout?scope=local', {method: 'POST'}).catch(() => {});
    clearTimeout(timer);
    session = null; user = null; pending = null;
    localStorage.removeItem(SESSION);
    localStorage.removeItem(ACTIVE);
    location.reload();
  }
  async function createGmailToken() {
    if(!user)throw new Error('Entre com Google no UlbraFlow para conectar o Gmail do celular.');
    await flush();
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    await request('/rest/v1/rpc/flow_create_gmail_token',{method:'POST',body:JSON.stringify({token_hash:hash})});
    return token;
  }
  async function revokeGmailToken(){if(!user)throw new Error('Entre com Google.');await request('/rest/v1/rpc/flow_revoke_gmail_token',{method:'POST',body:'{}'});}
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
  // Outra aba salvou: sem alterações próprias, esta aba adota a revisão (a interface já recarrega o cache);
  // com alterações, o 409 seguinte mescla.
  window.addEventListener('storage', event => {
    if (!user || conflict || pending || saving || event.key !== key + '.revision') return;
    const next = Number(event.newValue);
    if (!Number.isInteger(next) || next <= revision) return;
    revision = next;
    saved = localStorage.getItem(key) || saved;
  });
  // Novidades de outro aparelho: sem isso, um app que ficou aberto em segundo plano (celular) mostraria dados antigos
  // até ser recarregado. Primeiro só a revisão; os dados vêm apenas quando a nuvem tem algo mais novo.
  let pulling = null, pulledAt = 0;
  function pull(force = false) {
    if (!user || conflict || saving || pulling || (!force && Date.now() - pulledAt < 15000)) return pulling || Promise.resolve(false);
    pulledAt = Date.now();
    const select = fields => request(`/rest/v1/flow_workspaces?user_id=eq.${user.id}&select=${fields}`).then(rows => rows?.[0]);
    pulling = (async () => {
      const head = await select('revision');
      if (!Number.isInteger(head?.revision) || head.revision <= revision) return false;
      const remote = await select('data,revision');
      if (!remote || !Number.isInteger(remote.revision) || remote.revision <= revision || saving || conflict) return false;
      // A interface grava agora o que ainda está só na memória, para que entre na mesclagem.
      window.dispatchEvent(new CustomEvent('flow:persist-flush'));
      const remoteText = JSON.stringify(remote.data);
      let value = remote.data, next = null;
      if (pending) {
        if (!saved) return false;
        const result = merge(JSON.parse(saved), JSON.parse(pending), remote.data);
        // Mudança divergente no mesmo campo: o próximo envio recebe o 409 e mostra o conflito, como antes.
        if (result.conflicts.length) return false;
        value = result.value;
        const text = JSON.stringify(value);
        next = text === remoteText ? null : text;
      }
      pending = next;
      commit(remote.revision, remoteText);
      store(key, next || remoteText);
      if (pending) { setStatus('pending'); schedule(); }
      else { try { localStorage.removeItem(key + '.pending'); } catch {} setStatus('saved'); }
      window.dispatchEvent(new CustomEvent('flow:cloud-remote-merged', {detail: {data: value}}));
      return true;
    })().catch(() => false).finally(() => { pulling = null; });
    return pulling;
  }
  const wake = () => { if (globalThis.document?.visibilityState !== 'hidden') pull(); };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  globalThis.document?.addEventListener?.('visibilitychange', wake);
  if (typeof setInterval === 'function') setInterval(wake, 60000);
  // Lembretes de voz: o áudio pode levar alguns segundos para subir e ser transcrito.
  async function voiceNote(body){
    await ensureToken();const response=await fetch('/api/voice-note',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const result=await response.json().catch(()=>({}));if(!response.ok){const failure=new Error(result.error||`Falha ao processar o lembrete (HTTP ${response.status}).`);failure.status=response.status;failure.code=result.code;throw failure;}return result;
  }
  async function analyzeGmail(body){
    await ensureToken();const response=await fetch('/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const result=await response.json().catch(()=>({}));if(!response.ok){const failure=new Error(result.error||`Falha na análise (HTTP ${response.status}).`);failure.upstreamStatus=result.upstreamStatus;failure.status=response.status;throw failure;}return result;
  }
  async function ensureGoogleToken(kind,rejectedToken=null){
    const flag=kind==='gmail'?'gmailConnected':'calendarConnected';
    if(!session?.[flag]||!session.provider_token)throw new Error(kind==='gmail'?'Conecte a leitura do Gmail.':'Conecte o Google Agenda.');
    const fresh=()=>session?.provider_token&&(!session.google_access_expires_at||session.google_access_expires_at>Date.now()/1000+60);
    if((!rejectedToken&&fresh())||(rejectedToken&&session.provider_token!==rejectedToken&&fresh()))return session.provider_token;
    const owner=user?.id;
    if(!owner)throw new Error('Entre com Google no UlbraFlow.');
    if(!googleRefresh){
      const renew=async()=>{
        const latest=json(localStorage.getItem(SESSION));
        if(latest?.project===config.url&&latest.user?.id===owner)session=latest;
        if(!session?.[flag]||session.user?.id!==owner||user?.id!==owner)throw new Error('A conexão ou a conta Google mudou.');
        if((!rejectedToken&&fresh())||(rejectedToken&&session.provider_token!==rejectedToken&&fresh()))return session.provider_token;
        if(!session.provider_refresh_token){const failure=new Error('Conecte Gmail ou Agenda uma vez para habilitar a renovação automática.');failure.code='GOOGLE_RECONNECT_REQUIRED';throw failure;}
        await ensureToken();
        let response;
        try{response=await fetch('/api/google-token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify({refreshToken:session.provider_refresh_token}),signal:AbortSignal.timeout(35000)});}
        catch{throw new Error('Não foi possível renovar o Google agora. Tente novamente; suas conexões foram mantidas.');}
        const result=await response.json().catch(()=>({}));
        if(!response.ok){const failure=new Error(result.error||'Não foi possível renovar o Google agora.');failure.code=result.code;throw failure;}
        if(!session||session.user?.id!==owner||user?.id!==owner)throw new Error('A conta mudou durante a renovação.');
        // Desconectar durante a renovação não pode trazer o token de volta.
        if(!session.gmailConnected&&!session.calendarConnected)throw new Error('A conexão ou a conta Google mudou.');
        if(typeof result.accessToken!=='string'||!result.accessToken||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw new Error('A renovação retornou dados incompletos. Tente novamente.');
        remember({...session,provider_token:result.accessToken,provider_refresh_token:result.refreshToken||session.provider_refresh_token,google_access_expires_at:Math.floor(Date.now()/1000)+result.expiresIn});
        return session.provider_token;
      };
      googleRefresh=(globalThis.navigator?.locks?globalThis.navigator.locks.request('flow-google-refresh:'+owner,renew):renew()).finally(()=>{googleRefresh=null;});
    }
    try{const token=await googleRefresh;if(session?.user?.id!==owner||!session?.[flag])throw new Error('A conexão ou a conta Google mudou.');return token;}
    catch(failure){if(failure.code==='GOOGLE_RECONNECT_REQUIRED'&&session?.user?.id===owner)disconnect(flag,{provider_refresh_token:null});throw failure;}
  }
  async function googleFetch(kind,url,options={}){
    const target=new URL(url),prefix=kind==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/':'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    if(!['gmail','calendar'].includes(kind)||!target.href.startsWith(prefix)||target.username||target.password)throw new Error('Destino Google inválido.');
    const obtain=async rejected=>{try{return await ensureGoogleToken(kind,rejected);}catch(failure){failure.googleAuthorization=true;throw failure;}};
    const token=await obtain();
    const send=value=>fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+value}});
    const response=await send(token);
    if(response.status!==401)return response;
    const renewed=await obtain(token);
    return send(renewed);
  }
  globalThis.FlowCloud = {pull,voiceNote,googleFetch,ensureGoogleToken,analyzeGmail,gmailToken:()=>session?.gmailConnected?session.provider_token:null,disconnectGmail:()=>disconnect('gmailConnected'),createGmailToken, revokeGmailToken, initialize, signIn, signOut, queue, flush, loadRemote,
    info: () => ({mode: user ? 'cloud' : 'local', user, key, status, error, configured: !!config?.configured}),
    calendarToken: () => session?.calendarConnected ? session.provider_token : null,
    disconnectCalendar: () => disconnect('calendarConnected'),
    // Exposto para testes e para a interface conferir uma mesclagem sem tocar no estado.
    merge};
})();
