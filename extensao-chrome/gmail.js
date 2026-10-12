(() => {
  let buttonHost = null;
  let headingAnchor = null;
  let dialogHost = null;
  let dialogUrl = '';
  let scheduled = false;

  const visible = node => node.getClientRects().length > 0;
  function conversation() {
    const heading = [...document.querySelectorAll('h2.hP, .ha h2')].find(visible);
    const route = location.hash.split('?')[0];
    if (!heading || !/\/[a-zA-Z0-9_-]{8,}$/.test(route)) return null;
    const sender = [...document.querySelectorAll('.gD')].filter(visible).at(-1);
    return {
      heading,
      gmailSubject: heading.textContent.trim() || 'Conversa sem assunto',
      gmailSender: sender?.getAttribute('email') || sender?.textContent.trim() || '',
      gmailUrl: location.href
    };
  }

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
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível conectar ao Uflow.');
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
        dialog{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#213650;background:#fff;border:0;border-radius:18px;padding:26px;width:430px;max-width:calc(100vw - 32px);box-shadow:0 20px 80px #10244050}
        dialog::backdrop{background:#10244066}h2{font-size:22px;letter-spacing:-.5px;margin:0 0 5px}p{color:#61738c;margin:0 0 20px}.brand{color:#3268dc;font-weight:800;font-size:12px;letter-spacing:1px;margin-bottom:8px}
        label{display:block;font-weight:650;margin-top:16px}input,select{font:inherit;width:100%;padding:11px;border:1px solid #cfdaea;border-radius:9px;margin-top:6px;background:#fff;color:#213650}input:focus,select:focus{outline:2px solid #3268dc;outline-offset:2px}
        .sender{font-size:12px;color:#73849b;overflow-wrap:anywhere;margin-top:7px}.actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}button{font:inherit;font-weight:650;border-radius:9px;padding:10px 18px;border:1px solid #cfdaea;background:#fff;color:#213650;cursor:pointer}button.primary{background:#3268dc;color:#fff;border-color:#3268dc}button:disabled{opacity:.55;cursor:default}
        #flow-status{min-height:22px;margin-top:15px;color:#61738c;font-size:13px}#flow-status.error{color:#a4262c}#flow-status.success{color:#14774e}.footnote{font-size:12px;margin-top:12px;margin-bottom:0;color:#73849b}
      </style>
      <dialog aria-labelledby="flow-dialog-title">
        <div class="brand">UFLOW · GMAIL</div>
        <h2 id="flow-dialog-title">Incluir no Uflow</h2>
        <p>Classifique a demanda e inclua na esteira comum.</p>
        <form>
          <label>Título da tarefa<input name="title" maxlength="180" required></label>
          <div class="sender"></div>
          <label>1. Para onde vai? (área)<select name="project" required disabled><option value="">Carregando áreas…</option></select></label>
          <label>2. Para quando?<input name="dueDate" type="date" required></label>
          <div id="flow-status" role="status" aria-live="polite">Conectando ao Uflow…</div>
          <div class="actions"><button type="button" id="flow-close">Cancelar</button><button class="primary" type="submit" disabled>Salvar no Uflow</button></div>
          <p class="footnote">Área e data determinam a classificação. Todas as tarefas seguem pela mesma esteira.</p>
        </form>
      </dialog>`;
    document.body.appendChild(host);
    dialogHost = host;
    dialogUrl = email.gmailUrl;
    const dialog = shadow.querySelector('dialog');
    const form = shadow.querySelector('form');
    const title = form.elements.title;
    const select = form.elements.project;
    const dueDate = form.elements.dueDate;
    const status = shadow.querySelector('#flow-status');
    const save = shadow.querySelector('[type="submit"]');
    const cancel = shadow.querySelector('#flow-close');
    const requestId = crypto.randomUUID();
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
      if(finished){try{await send('FLOW_OPEN_EMAIL',{requestId});closeDialog()}catch(error){update(error.message,'error')}return;}
      if (saving || !select.value) return;
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      title.disabled = true;
      select.disabled = true;
      dueDate.disabled = true;
      update('Salvando no Uflow…');
      try {
        await send('FLOW_SAVE_EMAIL', {
          requestId, projectId: select.value, title: title.value.trim(), dueDate: dueDate.value,
          gmailUrl: email.gmailUrl, gmailSubject: email.gmailSubject, gmailSender: email.gmailSender
        });
        if (dialogHost !== host) return;
        finished = true;
        update('Salvo no Uflow! Você pode continuar no Gmail.', 'success');
        save.textContent = 'Ver no Uflow';
        save.disabled = false;
        cancel.textContent = 'Fechar';
      } catch (error) {
        if (dialogHost !== host) return;
        update(error.message, 'error');
        save.disabled = false;
        title.disabled = false;
        select.disabled = false;
        dueDate.disabled = false;
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
        update('Crie uma área no Uflow para que ela apareça aqui.', 'error');
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

  function syncButton() {
    const email = conversation();
    if (dialogHost && dialogUrl !== location.href) closeDialog();
    if (!email) {
      buttonHost?.remove();
      buttonHost = null;
      headingAnchor = null;
      return;
    }
    if (buttonHost?.isConnected && headingAnchor === email.heading) return;
    buttonHost?.remove();
    buttonHost = document.createElement('span');
    buttonHost.id = 'flow-gmail-button';
    const shadow = buttonHost.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>:host{display:inline-flex;vertical-align:middle;margin:6px 0 6px 12px}button{font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;background:#3268dc;color:#fff;border:0;border-radius:18px;padding:9px 16px;cursor:pointer;white-space:nowrap}button:hover{background:#2453bc}button:focus-visible{outline:3px solid #91b7ff;outline-offset:3px}</style><button type="button">+ Incluir no Uflow</button>`;
    shadow.querySelector('button').addEventListener('click', openDialog);
    headingAnchor = email.heading;
    headingAnchor.insertAdjacentElement('afterend', buttonHost);
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
