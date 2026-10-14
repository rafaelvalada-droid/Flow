(() => {
  let buttonHost = null;
  let completeHost = null;
  let lookup = 0;
  let headingAnchor = null;
  let dialogHost = null;
  let dialogUrl = '';
  let scheduled = false;

  const visible = node => node.getClientRects().length > 0;
  // O ID hexadecimal do assunto aberto é o mesmo da Gmail API: o UlbraFlow reconhece a conversa vinda de qualquer origem.
  // Só o cabeçalho da conversa é lido; linhas da lista (painel de leitura) têm IDs de outras conversas.
  function legacyId(heading, names, perm = '') {
    for (const name of names) {
      const hex = (heading.getAttribute(name) || '').replace(/^#/, '').toLowerCase();
      if (/^[a-f0-9]{8,40}$/.test(hex)) return hex;
    }
    const decimal = perm && /^#?thread-f:(\d{1,30})$/.exec(heading.getAttribute(perm) || '')?.[1];
    return decimal ? BigInt(decimal).toString(16) : '';
  }
  function account() {
    return / - ([^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+) - [^@]*$/.exec(document.title)?.[1] || '';
  }
  function link(threadId) {
    if (!threadId) return location.href;
    const email = account(), index = /^\/mail\/u\/(\d{1,2})\//.exec(location.pathname)?.[1];
    return 'https://mail.google.com/mail/' + (email ? '?authuser=' + encodeURIComponent(email) : index ? 'u/' + index + '/' : '') + '#all/' + threadId;
  }
  function conversation() {
    const heading = [...document.querySelectorAll('h2.hP, .ha h2')].find(visible);
    const route = location.hash.split('?')[0];
    if (!heading || !/\/[a-zA-Z0-9_-]{8,}$/.test(route)) return null;
    const sender = [...document.querySelectorAll('.gD')].filter(visible).at(-1);
    const gmailThreadId = legacyId(heading, ['data-legacy-thread-id'], 'data-thread-perm-id');
    const gmailMessageId = gmailThreadId ? legacyId(heading, ['data-legacy-last-non-draft-message-id', 'data-legacy-last-message-id']) : '';
    return {
      heading,
      gmailSubject: heading.textContent.trim() || 'Conversa sem assunto',
      gmailSender: sender?.getAttribute('email') || sender?.textContent.trim() || '',
      gmailUrl: link(gmailThreadId), gmailThreadId, gmailMessageId
    };
  }

  // Botão Arquivar da barra do Gmail (o mesmo que o usuário clicaria); o Gmail volta para a lista.
  function archiveButton() {
    const label = node => (node.getAttribute('aria-label') || node.getAttribute('data-tooltip') || '').trim();
    return [...document.querySelectorAll('[act="7"]')].find(visible) ||
      [...document.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip]')].find(node => visible(node) && /^(arquivar|archive)$/i.test(label(node)));
  }
  async function archiveInGmail() {
    const target = archiveButton();
    if (!target) return false;
    const before = location.href;
    for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
    for (let i = 0; i < 40 && location.href === before; i++) await new Promise(resolve => setTimeout(resolve, 100));
    return location.href !== before;
  }
  const archivePreference = {
    async get() { try { return (await chrome.storage.local.get('archiveOnSave')).archiveOnSave !== false; } catch { return true; } },
    set(value) { try { chrome.storage.local.set({archiveOnSave: !!value}); } catch {} }
  };

  function closeDialog() {
    if (!dialogHost) return;
    dialogHost.remove();
    dialogHost = null;
    dialogUrl = '';
    buttonHost?.shadowRoot.querySelector('button')?.focus();
  }

  async function send(type, data) {
    let result;
    try { result = await chrome.runtime.sendMessage({type, data}); }
    catch { throw new Error('A extensão foi atualizada. Recarregue o Gmail e tente novamente.'); }
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível conectar ao UlbraFlow.');
    return result;
  }

  async function openDialog() {
    const email = conversation();
    if (!email || dialogHost) return;
    const host = document.createElement('div');
    host.id = 'flow-gmail-dialog';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}
        dialog{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#182b49;background:#f0f5fc;border:0;border-radius:18px;padding:26px;width:430px;max-width:calc(100vw - 32px);box-shadow:0 20px 80px #3166dc40}
        dialog::backdrop{background:#182b4966}h2{font-size:22px;letter-spacing:-.5px;margin:0 0 5px}p{color:#5b6f8c;margin:0 0 20px}.brand{color:#3166dc;border-left:3px solid #3166dc;padding-left:8px;font-weight:800;font-size:12px;letter-spacing:1px;margin-bottom:8px}
        label{display:block;font-weight:650;margin-top:16px}label.check{display:flex;align-items:center;gap:8px;font-weight:600}label.check input{width:auto;margin:0;accent-color:#3166dc}input,select{font:inherit;width:100%;padding:11px;border:1px solid #c8d7ee;border-radius:9px;margin-top:6px;background:#fff;color:#182b49}input:focus,select:focus{outline:2px solid #3166dc;outline-offset:2px}
        .sender{font-size:12px;color:#5b6f8c;overflow-wrap:anywhere;margin-top:7px}.actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}button{font:inherit;font-weight:650;border-radius:9px;padding:10px 18px;border:1px solid #c8d7ee;background:#fff;color:#182b49;cursor:pointer}button:hover{background:#e4edfb}button.primary{background:#3166dc;color:#fff;border-color:#3166dc}button.primary:hover{background:#2554be;border-color:#2554be}button:focus-visible{outline:3px solid #3166dc;outline-offset:3px}button:disabled{opacity:.55;cursor:default}
        #flow-status{min-height:22px;margin-top:15px;color:#5b6f8c;font-size:13px}#flow-status.error{color:#a4262c}#flow-status.success{color:#14774e}.footnote{font-size:12px;margin-top:12px;margin-bottom:0;color:#5b6f8c}
      </style>
      <dialog aria-labelledby="flow-dialog-title">
        <div class="brand">ULBRAFLOW · GMAIL</div>
        <h2 id="flow-dialog-title">Incluir no UlbraFlow</h2>
        <p>Classifique a demanda e inclua na esteira comum.</p>
        <form>
          <label>Título da tarefa<input name="title" maxlength="180" required></label>
          <div class="sender"></div>
          <label>1. Para onde vai? (área)<select name="project" required disabled><option value="">Carregando áreas…</option></select></label>
          <label>2. Para quando?<input name="dueDate" type="date" required></label>
          <label class="check"><input name="archive" type="checkbox" checked> Arquivar o e-mail no Gmail depois de incluir</label>
          <div id="flow-status" role="status" aria-live="polite">Conectando ao UlbraFlow…</div>
          <div class="actions"><button type="button" id="flow-close">Cancelar</button><button class="primary" type="submit" disabled>Salvar no UlbraFlow</button></div>
          <p class="footnote">Área e data determinam a classificação. Todas as tarefas seguem pela mesma esteira.</p>
        </form>
      </dialog>`;
    document.body.appendChild(host);
    dialogHost = host;
    dialogUrl = location.href;
    const dialog = shadow.querySelector('dialog');
    const form = shadow.querySelector('form');
    const title = form.elements.title;
    const select = form.elements.project;
    const dueDate = form.elements.dueDate;
    const archive = form.elements.archive;
    archivePreference.get().then(value => { archive.checked = value; });
    archive.addEventListener('change', () => archivePreference.set(archive.checked));
    const status = shadow.querySelector('#flow-status');
    const save = shadow.querySelector('[type="submit"]');
    const cancel = shadow.querySelector('#flow-close');
    const requestId = crypto.randomUUID();
    let opened = {requestId};
    let saving = false;
    let finished = false;
    title.value = email.gmailSubject.slice(0, 180);
    shadow.querySelector('.sender').textContent = email.gmailSender;
    const update = (message, state = '') => {status.textContent = message;status.className = state;};
    cancel.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();closeDialog();}
    });
    let outsidePress = false;
    const outside = event => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    dialog.addEventListener('pointerdown', event => {outsidePress = event.target === dialog && outside(event);});
    dialog.addEventListener('click', event => {
      if (outsidePress && event.target === dialog && outside(event)) closeDialog();
      outsidePress = false;
    });
    dialog.showModal();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if(finished){try{await send('FLOW_OPEN_EMAIL',opened);closeDialog()}catch(error){update(error.message,'error')}return;}
      if (saving || !select.value) return;
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      title.disabled = true;
      select.disabled = true;
      dueDate.disabled = true;
      archive.disabled = true;
      update('Salvando no UlbraFlow…');
      try {
        const result = await send('FLOW_SAVE_EMAIL', {
          requestId, projectId: select.value, title: title.value.trim(), dueDate: dueDate.value,
          gmailUrl: email.gmailUrl, gmailSubject: email.gmailSubject, gmailSender: email.gmailSender,
          gmailThreadId: email.gmailThreadId, gmailMessageId: email.gmailMessageId
        });
        if (dialogHost !== host) return;
        finished = true;
        opened = {requestId: result.requestId || requestId, taskId: result.taskId};
        if (buttonHost?.isConnected && headingAnchor === email.heading) syncComplete(email);
        const saved = result.duplicate ? 'Esta conversa já está no UlbraFlow. Nenhuma tarefa nova foi criada.' : 'Salvo no UlbraFlow! Você pode continuar no Gmail.';
        update(saved, 'success');
        save.textContent = 'Ver no UlbraFlow';
        save.disabled = false;
        cancel.textContent = 'Fechar';
        // Só depois de salvo: se o Gmail arquivar, ele volta para a lista e a caixa fecha sozinha.
        if (archive.checked) {
          update(saved + ' Arquivando o e-mail…', 'success');
          let reason = '';
          try {
            if (!await archiveInGmail()) {
              await send('FLOW_ARCHIVE_EMAIL', {gmailThreadId: email.gmailThreadId, gmailMessageId: email.gmailMessageId});
              if (dialogHost === host) closeDialog();
              location.hash = '#inbox';
            }
          } catch (error) { reason = error.message; }
          if (reason && dialogHost === host) update(saved + ' O e-mail não foi arquivado: ' + reason, 'error');
        }
      } catch (error) {
        if (dialogHost !== host) return;
        update(error.message, 'error');
        save.disabled = false;
        title.disabled = false;
        select.disabled = false;
        dueDate.disabled = false;
        archive.disabled = false;
      } finally {
        saving = false;
        cancel.disabled = false;
      }
    });
    try {
      const result = await send('FLOW_LISTS');
      if (dialogHost !== host) return;
      select.replaceChildren(new Option('Escolha uma área', ''));
      for (const project of result.projects) select.add(new Option(project.name, project.id));
      if (!result.projects.length) {
        update('Crie uma área no UlbraFlow para que ela apareça aqui.', 'error');
        return;
      }
      select.disabled = false;
      save.disabled = false;
      update('');
      select.focus();
    } catch (error) {
      if (dialogHost === host) update(error.message, 'error');
    }
  }

  function removeComplete() {
    lookup++;
    completeHost?.remove();
    completeHost = null;
  }

  // "Concluir e voltar" aparece só quando a conversa tem uma tarefa aberta numa aba do UlbraFlow já aberta.
  async function syncComplete(email) {
    removeComplete();
    const current = lookup, anchor = buttonHost;
    if (!email.gmailThreadId) return;
    let result;
    try { result = await send('FLOW_FIND_EMAIL', {gmailThreadId: email.gmailThreadId}); } catch { return; }
    if (current !== lookup || buttonHost !== anchor || !anchor?.isConnected || !result.task || result.task.status === 'done') return;
    const host = document.createElement('span');
    host.id = 'flow-gmail-complete';
    const shadow = host.attachShadow({mode: 'open'});
    const label = '✓ Concluir e voltar ao UlbraFlow';
    shadow.innerHTML = `<style>:host{display:inline-flex;align-items:center;gap:8px;vertical-align:middle;margin:6px 0 6px 8px}button{font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;background:#14774e;color:#fff;border:0;border-radius:18px;padding:9px 16px;cursor:pointer;white-space:nowrap}button:hover{background:#0f5f3e}button:focus-visible{outline:3px solid #14774e;outline-offset:3px}button:disabled{opacity:.6;cursor:default}span{font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:#a4262c;max-width:360px}</style><button type="button"></button><span role="status" aria-live="polite"></span>`;
    const button = shadow.querySelector('button'), status = shadow.querySelector('span');
    button.textContent = label;
    button.title = 'Marca a tarefa desta conversa como concluída no UlbraFlow e volta para lá';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Concluindo…';
      status.textContent = '';
      try {
        const done = await send('FLOW_COMPLETE_EMAIL', {gmailThreadId: email.gmailThreadId});
        // Aba aberta pelo UlbraFlow: a extensão fecha. Aba principal do Gmail: volta para a caixa de entrada.
        if (!done.closed) {removeComplete();location.hash = '#inbox';}
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        status.textContent = error.message;
      }
    });
    completeHost = host;
    anchor.insertAdjacentElement('afterend', host);
  }

  function syncButton() {
    const email = conversation();
    if (dialogHost && dialogUrl !== location.href) closeDialog();
    if (!email) {
      buttonHost?.remove();
      buttonHost = null;
      headingAnchor = null;
      removeComplete();
      return;
    }
    if (buttonHost?.isConnected && headingAnchor === email.heading) return;
    buttonHost?.remove();
    buttonHost = document.createElement('span');
    buttonHost.id = 'flow-gmail-button';
    const shadow = buttonHost.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>:host{display:inline-flex;vertical-align:middle;margin:6px 0 6px 12px}button{font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;background:#3166dc;color:#fff;border:0;border-radius:18px;padding:9px 16px;cursor:pointer;white-space:nowrap}button:hover{background:#2554be}button:focus-visible{outline:3px solid #3166dc;outline-offset:3px}</style><button type="button">+ Incluir no UlbraFlow</button>`;
    shadow.querySelector('button').addEventListener('click', openDialog);
    headingAnchor = email.heading;
    headingAnchor.insertAdjacentElement('afterend', buttonHost);
    syncComplete(email);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {scheduled = false;syncButton();}, 100);
  }
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, characterData: true});
  window.addEventListener('hashchange', schedule);
  syncButton();
})();
