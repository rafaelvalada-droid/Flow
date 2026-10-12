(() => {
  if (globalThis.__flowGmailBridge) return;
  globalThis.__flowGmailBridge = true;
  let key = 'flow.workspace.v1';
  let cloudMode = false;

  function read() {
    let active;
    try {active=JSON.parse(localStorage.getItem('flow.active-workspace.v1'));}catch{}
    cloudMode=active?.mode==='cloud';
    if (localStorage.getItem('flow.cloud-required.v1')) {
      if (!cloudMode || !/^[a-f0-9-]{36}$/i.test(active.userId||'') ||
          active.key !== `flow.workspace.v1:${active.userId}` || document.querySelector('.app-shell')?.hidden !== false) {
        throw new Error('Entre com Google no Ulbraflow neste perfil do Chrome e tente novamente.');
      }
    }
    key=cloudMode?active.key:'flow.workspace.v1';
    const raw = localStorage.getItem(key);
    let db;
    try { db = JSON.parse(raw); } catch {}
    if (db?.version !== 1 || !Array.isArray(db.projects) || !Array.isArray(db.tasks)) {
      throw new Error('Abra o Ulbraflow uma vez neste perfil do Chrome e tente novamente.');
    }
    return {db, raw};
  }

  async function acknowledge(requestId) {
    if (!cloudMode) return;
    await new Promise((resolve,reject)=>{
      const finish=event=>{
        if(event.detail?.requestId!==requestId)return;
        clearTimeout(timeout);window.removeEventListener('flow:cloud-save-result',finish);
        if(event.detail.ok)resolve();else reject(new Error(event.detail.error||'Não foi possível salvar na nuvem. Tente novamente.'));
      };
      const timeout=setTimeout(()=>{window.removeEventListener('flow:cloud-save-result',finish);reject(new Error('A nuvem ainda não confirmou o salvamento. Abra o Ulbraflow e tente novamente.'));},15000);
      window.addEventListener('flow:cloud-save-result',finish);
      window.dispatchEvent(new CustomEvent('flow:cloud-save',{detail:{requestId,key}}));
    });
  }

  async function save(data) {
    if (!data || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)) {
      throw new Error('Solicitação de captura inválida.');
    }
    const {db, raw} = read();
    const existing = db.tasks.find(task => task.gmailCaptureId === data.requestId);
    if (existing) {await acknowledge(data.requestId);return {taskId: existing.id};}
    const project = db.projects.find(item => item.id === data.projectId);
    if (!project) throw new Error('Essa área foi removida. Feche a caixa e escolha uma área atualizada.');
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title || title.length > 180) throw new Error('Informe um título de até 180 caracteres.');
    let gmail;
    try { gmail = new URL(data.gmailUrl); } catch {}
    if (!gmail || gmail.protocol !== 'https:' || gmail.hostname !== 'mail.google.com' ||
        gmail.username || gmail.password || !/\/[a-zA-Z0-9_-]{8,}$/.test(gmail.hash.split('?')[0])) {
      throw new Error('Abra uma conversa válida no Gmail para incluir no Ulbraflow.');
    }
    const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
    const dueDate = data.dueDate || '';
    const date = typeof dueDate === 'string' ? new Date(dueDate + 'T12:00:00') : new Date(NaN);
    const calendarDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    if (dueDate && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        calendarDate !== dueDate)) {
      throw new Error('Informe uma data válida para a demanda.');
    }
    const task = {
      id: crypto.randomUUID(), title, project: project.id, status: 'todo', priority: 'medium',
      plannedDate: '', plannedTime: '', dueDate, description: '', subtasks: [], sessions: [],
      startedAt: null, focusCycles: 0, gmailUrl: gmail.href, gmailSubject: text(data.gmailSubject, 180),
      gmailSender: text(data.gmailSender, 150), gmailCaptureId: data.requestId,
      createdAt: Date.now(), completedAt: null
    };
    db.tasks.unshift(task);
    const next = JSON.stringify(db);
    // Persist first. A quota error must never be reported as a successful save.
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent('storage', {key, oldValue: raw, newValue: next, storageArea: localStorage, url: location.href}));
    await acknowledge(data.requestId);
    return {taskId: task.id};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !['FLOW_BRIDGE_LISTS', 'FLOW_BRIDGE_SAVE', 'FLOW_BRIDGE_OPEN'].includes(message?.type)) return;
    (async()=>{try {
      // A freshly opened Ulbraflow tab may still be checking OAuth and loading its data.
      const started=Date.now();
      while(document.querySelector('.app-shell')?.hidden && document.querySelector('#google-login')?.hidden && Date.now()-started<12000)await new Promise(resolve=>setTimeout(resolve,50));
      if(message.type==='FLOW_BRIDGE_OPEN'){const task=read().db.tasks.find(t=>t.gmailCaptureId===message.data?.requestId);if(!task)throw new Error('A demanda não está neste Ulbraflow. Confira o endereço configurado na extensão.');window.dispatchEvent(new CustomEvent('flow:open-capture',{detail:{requestId:message.data.requestId}}));sendResponse({ok:true});return;}
      const result = message.type === 'FLOW_BRIDGE_SAVE' ? await save(message.data) : {
        projects: read().db.projects.filter(p => typeof p.id === 'string' && typeof p.name === 'string')
          .map(p => ({id: p.id, name: p.name}))
      };
      sendResponse({ok: true, ...result});
    } catch (error) {
      sendResponse({ok: false, error: error.name === 'QuotaExceededError' ?
        'O navegador está sem espaço para salvar. Faça um backup do Ulbraflow e libere espaço.' : error.message});
    }})();
    return true;
  });
})();
