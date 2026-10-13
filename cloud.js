(() => {
  'use strict';
  const SESSION = 'flow.auth.session.v1', ACTIVE = 'flow.active-workspace.v1';
  // An open shell is not proof that this account has finished authentication.
  localStorage.removeItem(ACTIVE);
  const REQUIRED = 'flow.cloud-required.v1', PKCE = 'flow.auth.pkce.v1';
  let config, session, user, key = 'flow.workspace.v1', revision = 0;
  let pending = null, saved = '', timer, saving, refresh, conflict = false;
  let googleRefresh;
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
        const current=session?.user?.id===old.user.id?session:old;
        remember({...next, provider_token:current.provider_token,provider_refresh_token:current.provider_refresh_token,google_access_expires_at:current.google_access_expires_at,calendarConnected:current.calendarConnected,gmailConnected:current.gmailConnected});
      };
      refresh = (navigator.locks ? navigator.locks.request('flow-auth-refresh', renew) : renew()).finally(() => { refresh = null; });
    }
    await refresh;
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
  async function initialize() {
    let resumePage=null;
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
      if (proof.expectedUser && next?.user?.id !== proof.expectedUser) throw new Error('Conecte a Agenda usando a mesma conta Google do UlbraFlow.');
      if(proof.gmail)resumePage='entrada';
      const previous=session?.user?.id===next.user?.id?session:null;
      remember({...next,provider_refresh_token:next.provider_refresh_token||previous?.provider_refresh_token||null,
        google_access_expires_at:next.provider_token?Math.floor(Date.now()/1000)+3500:0,
        calendarConnected:!!(proof.calendar&&next.provider_token),gmailConnected:!!(proof.gmail&&next.provider_token)});
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
    return {mode: 'cloud', key, data, user,resumePage};
  }
  function queue(data, serialized = JSON.stringify(data)) {
    if (!user) return;
    if ((serialized === saved && !pending)||serialized===pending) return;
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
  async function analyzeGmail(body){
    await ensureToken();const response=await fetch('/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const result=await response.json();if(!response.ok){const failure=new Error(result.error||'Falha na análise.');failure.upstreamStatus=result.upstreamStatus;throw failure;}return result;
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
        if(typeof result.accessToken!=='string'||!result.accessToken||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw new Error('A renovação retornou dados incompletos. Tente novamente.');
        remember({...session,provider_token:result.accessToken,provider_refresh_token:result.refreshToken||session.provider_refresh_token,google_access_expires_at:Math.floor(Date.now()/1000)+result.expiresIn});
        return session.provider_token;
      };
      googleRefresh=(globalThis.navigator?.locks?globalThis.navigator.locks.request('flow-google-refresh:'+owner,renew):renew()).finally(()=>{googleRefresh=null;});
    }
    try{const token=await googleRefresh;if(session?.user?.id!==owner||!session?.[flag])throw new Error('A conexão ou a conta Google mudou.');return token;}
    catch(failure){if(failure.code==='GOOGLE_RECONNECT_REQUIRED'&&session?.user?.id===owner){remember({...session,[flag]:false,provider_refresh_token:null});}throw failure;}
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
  globalThis.FlowCloud = {googleFetch,ensureGoogleToken,analyzeGmail,gmailToken:()=>session?.gmailConnected?session.provider_token:null,disconnectGmail:()=>{if(session)remember({...session,gmailConnected:false})},createGmailToken, revokeGmailToken, initialize, signIn, signOut, queue, flush, loadRemote,
    info: () => ({mode: user ? 'cloud' : 'local', user, key, status, error, configured: !!config?.configured}),
    calendarToken: () => session?.calendarConnected ? session.provider_token : null,
    disconnectCalendar: () => { if (session) { remember({...session, calendarConnected: false}); } }};
})();
