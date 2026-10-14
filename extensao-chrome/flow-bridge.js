(() => {
  if (globalThis.__flowGmailBridge) return;
  globalThis.__flowGmailBridge = true;
  let key = 'flow.workspace.v1';
  let cloudMode = false;
  const opening=()=>document.querySelector('.app-shell')?.hidden||document.querySelector('.sidebar')?.inert;

  function read() {
    if(opening())throw new Error('Aguarde a abertura do UlbraFlow ou entre com Google antes de capturar.');
    // O app grava com atraso; este evento grava agora o que estiver só na memória antes da leitura.
    window.dispatchEvent(new Event('flow:persist-flush'));
    let active;
    try {active=JSON.parse(localStorage.getItem('flow.active-workspace.v1'));}catch{}
    cloudMode=active?.mode==='cloud';
    if (localStorage.getItem('flow.cloud-required.v1')) {
      if (!cloudMode || !/^[a-f0-9-]{36}$/i.test(active.userId||'') ||
          active.key !== `flow.workspace.v1:${active.userId}` || document.querySelector('.app-shell')?.hidden !== false) {
        throw new Error('Entre com Google no UlbraFlow neste perfil do Chrome e tente novamente.');
      }
    }
    key=cloudMode?active.key:'flow.workspace.v1';
    const raw = localStorage.getItem(key);
    let db;
    try { db = JSON.parse(raw); } catch {}
    if (db?.version !== 1 || !Array.isArray(db.projects) || !Array.isArray(db.tasks)) {
      throw new Error('Abra o UlbraFlow uma vez neste perfil do Chrome e tente novamente.');
    }
    return {db, raw};
  }

  async function acknowledge(requestId) {
    if (!cloudMode) return;
    let merged=false;
    await new Promise((resolve,reject)=>{
      let timeout;
      const stop=()=>{clearTimeout(timeout);window.removeEventListener('flow:cloud-save-result',finish);window.removeEventListener('flow:cloud-remote-merged',remerge);};
      // Workspaces grandes levam até 60 s por envio no cloud.js; o prazo cobre um envio completo.
      const wait=()=>{clearTimeout(timeout);timeout=setTimeout(()=>{stop();reject(new Error('A nuvem ainda não confirmou o salvamento. Abra o UlbraFlow e tente novamente.'));},65000);};
      // Um conflito 409 mesclado automaticamente reenvia o salvamento; o prazo recomeça e o resultado final decide.
      const remerge=()=>{merged=true;wait();};
      const finish=event=>{
        if(event.detail?.requestId!==requestId)return;
        stop();
        if(event.detail.ok)resolve();else reject(new Error(event.detail.error||'Não foi possível salvar na nuvem. Tente novamente.'));
      };
      wait();
      window.addEventListener('flow:cloud-save-result',finish);
      window.addEventListener('flow:cloud-remote-merged',remerge);
      window.dispatchEvent(new CustomEvent('flow:cloud-save',{detail:{requestId,key}}));
    });
    // Depois da mesclagem, só confirma se a demanda continua no workspace que foi salvo.
    if(!read().db.tasks.some(task=>task.gmailCaptureId===requestId))throw new Error(merged?'Outro dispositivo alterou o UlbraFlow durante o salvamento e a demanda não foi mantida. Clique em Salvar novamente.':'A demanda não foi recebida pelo UlbraFlow. Recarregue o app e tente novamente.');
  }
  const threadOf=value=>typeof value==='string'&&/^[a-f0-9]{8,40}$/.test(value)?value:'';
  // Mesma conversa já capturada pela extensão, pelo celular ou pela revisão da Entrada.
  const linked=(db,id)=>id?db.tasks.find(task=>task.gmailThreadId===id||task.gmailCaptureId==='gmail-mobile-'+id||task.gmailCaptureId==='gmail-review-'+id||(typeof task.gmailUrl==='string'&&task.gmailUrl.endsWith('#all/'+id))):null;

  // Situação da tarefa ligada à conversa, para o Gmail mostrar "Concluir e voltar" só quando há o que concluir.
  // Só ID e etapa saem do UlbraFlow: o título não é exposto à página do Gmail.
  function find(data) {
    const task = linked(read().db, threadOf(data?.gmailThreadId));
    return {task: task ? {id: task.id, status: task.status} : null};
  }

  // A conclusão é feita pelo próprio app (mesma regra do botão Concluir), que responde com flow:complete-task-result.
  async function complete(data) {
    const task = linked(read().db, threadOf(data?.gmailThreadId));
    if (!task) throw new Error('Esta conversa não está no UlbraFlow. Use Incluir no UlbraFlow primeiro.');
    const requestId = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const stop = () => {clearTimeout(timeout);window.removeEventListener('flow:complete-task-result', finish);};
      const timeout = setTimeout(() => {stop();reject(new Error('O UlbraFlow não respondeu. Atualize a aba do UlbraFlow e tente novamente.'));}, 10000);
      const finish = event => {
        if (event.detail?.requestId !== requestId) return;
        stop();
        if (event.detail.ok) resolve(); else reject(new Error(event.detail.error || 'Não foi possível concluir a tarefa.'));
      };
      window.addEventListener('flow:complete-task-result', finish);
      window.dispatchEvent(new CustomEvent('flow:complete-task', {detail: {requestId, taskId: task.id}}));
    });
    return {taskId: task.id};
  }

  async function save(data) {
    if (!data || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)) {
      throw new Error('Solicitação de captura inválida.');
    }
    const {db, raw} = read();
    const existing = db.tasks.find(task => task.gmailCaptureId === data.requestId);
    if (existing) {await acknowledge(data.requestId);return {taskId: existing.id, requestId: data.requestId};}
    const threadId = threadOf(data.gmailThreadId), duplicate = linked(db, threadId);
    if (duplicate) {
      if (duplicate.gmailCaptureId) await acknowledge(duplicate.gmailCaptureId);
      return {taskId: duplicate.id, requestId: duplicate.gmailCaptureId || '', duplicate: true};
    }
    const project = db.projects.find(item => item.id === data.projectId);
    if (!project) throw new Error('Essa área foi removida. Feche a caixa e escolha uma área atualizada.');
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title || title.length > 180) throw new Error('Informe um título de até 180 caracteres.');
    let gmail;
    try { gmail = new URL(data.gmailUrl); } catch {}
    if (!gmail || gmail.protocol !== 'https:' || gmail.hostname !== 'mail.google.com' ||
        gmail.username || gmail.password || !/\/[a-zA-Z0-9_-]{8,}$/.test(gmail.hash.split('?')[0])) {
      throw new Error('Abra uma conversa válida no Gmail para incluir no UlbraFlow.');
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
      ...(threadId ? {gmailThreadId: threadId} : {}), ...(threadId && threadOf(data.gmailMessageId) ? {gmailMessageId: data.gmailMessageId} : {}),
      createdAt: Date.now(), completedAt: null
    };
    db.tasks.unshift(task);
    const next = JSON.stringify(db);
    // Persist first. A quota error must never be reported as a successful save.
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent('storage', {key, oldValue: raw, newValue: next, storageArea: localStorage, url: location.href}));
    await acknowledge(data.requestId);
    return {taskId: task.id, requestId: data.requestId};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !['FLOW_BRIDGE_LISTS', 'FLOW_BRIDGE_SAVE', 'FLOW_BRIDGE_OPEN', 'FLOW_BRIDGE_FIND', 'FLOW_BRIDGE_COMPLETE'].includes(message?.type)) return;
    (async()=>{try {
      // A freshly opened UlbraFlow tab may still be checking OAuth and loading its data.
      const started=Date.now();
      while(opening() && document.querySelector('#google-login')?.hidden && Date.now()-started<12000)await new Promise(resolve=>setTimeout(resolve,50));
      if(message.type==='FLOW_BRIDGE_FIND'){sendResponse({ok:true,...find(message.data)});return;}
      if(message.type==='FLOW_BRIDGE_COMPLETE'){sendResponse({ok:true,...await complete(message.data)});return;}
      if(message.type==='FLOW_BRIDGE_OPEN'){const {requestId,taskId}=message.data||{},task=read().db.tasks.find(t=>(requestId&&t.gmailCaptureId===requestId)||(taskId&&t.id===taskId));if(!task)throw new Error('A demanda não está neste UlbraFlow. Confira o endereço configurado na extensão.');window.dispatchEvent(new CustomEvent('flow:open-capture',{detail:{requestId:task.gmailCaptureId||'',taskId:task.id}}));sendResponse({ok:true});return;}
      const result = message.type === 'FLOW_BRIDGE_SAVE' ? await save(message.data) : {
        projects: read().db.projects.filter(p => typeof p.id === 'string' && typeof p.name === 'string')
          .map(p => ({id: p.id, name: p.name}))
      };
      sendResponse({ok: true, ...result});
    } catch (error) {
      sendResponse({ok: false, error: error.name === 'QuotaExceededError' ?
        'O navegador está sem espaço para salvar. Faça um backup do UlbraFlow e libere espaço.' : error.message});
    }})();
    return true;
  });
})();
