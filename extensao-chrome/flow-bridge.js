(() => {
  if (globalThis.__flowGmailBridge) return;
  globalThis.__flowGmailBridge = true;
  const key = 'flow.workspace.v1';

  function read() {
    const raw = localStorage.getItem(key);
    let db;
    try { db = JSON.parse(raw); } catch {}
    if (db?.version !== 1 || !Array.isArray(db.projects) || !Array.isArray(db.tasks)) {
      throw new Error('Abra o Flow uma vez neste perfil do Chrome e tente novamente.');
    }
    return {db, raw};
  }

  function save(data) {
    if (!data || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)) {
      throw new Error('Solicitação de captura inválida.');
    }
    const {db, raw} = read();
    const existing = db.tasks.find(task => task.gmailCaptureId === data.requestId);
    if (existing) return {taskId: existing.id};
    const project = db.projects.find(item => item.id === data.projectId);
    if (!project) throw new Error('Essa lista foi removida. Feche a caixa e escolha uma lista atualizada.');
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title || title.length > 180) throw new Error('Informe um título de até 180 caracteres.');
    let gmail;
    try { gmail = new URL(data.gmailUrl); } catch {}
    if (!gmail || gmail.protocol !== 'https:' || gmail.hostname !== 'mail.google.com' ||
        gmail.username || gmail.password || !/\/[a-zA-Z0-9_-]{8,}$/.test(gmail.hash.split('?')[0])) {
      throw new Error('Abra uma conversa válida no Gmail para incluir no Flow.');
    }
    const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
    const task = {
      id: crypto.randomUUID(), title, project: project.id, status: 'todo', priority: 'medium',
      plannedDate: '', plannedTime: '', dueDate: '', description: '', subtasks: [], sessions: [],
      startedAt: null, gmailUrl: gmail.href, gmailSubject: text(data.gmailSubject, 180),
      gmailSender: text(data.gmailSender, 150), gmailCaptureId: data.requestId,
      createdAt: Date.now(), completedAt: null
    };
    db.tasks.unshift(task);
    const next = JSON.stringify(db);
    // Persist first. A quota error must never be reported as a successful save.
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent('storage', {key, oldValue: raw, newValue: next, storageArea: localStorage, url: location.href}));
    return {taskId: task.id};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !['FLOW_BRIDGE_LISTS', 'FLOW_BRIDGE_SAVE'].includes(message?.type)) return;
    try {
      const result = message.type === 'FLOW_BRIDGE_SAVE' ? save(message.data) : {
        projects: read().db.projects.filter(p => typeof p.id === 'string' && typeof p.name === 'string')
          .map(p => ({id: p.id, name: p.name}))
      };
      sendResponse({ok: true, ...result});
    } catch (error) {
      sendResponse({ok: false, error: error.name === 'QuotaExceededError' ?
        'O navegador está sem espaço para salvar. Faça um backup do Flow e libere espaço.' : error.message});
    }
  });
})();
