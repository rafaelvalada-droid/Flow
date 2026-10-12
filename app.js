/* Interface Flow. Autenticação, sincronização e regras ficam em módulos separados. */
(async () => {
  'use strict';
  const cloud = globalThis.FlowCloud;
  const loginMessage = document.querySelector('#login-message');
  document.querySelector('#google-login').addEventListener('click', async () => {
    try { await cloud.signIn(); } catch (error) { loginMessage.textContent = error.message; }
  });
  document.querySelector('#login-retry').addEventListener('click', () => location.reload());
  const stopLoading=()=>document.querySelector('.login-loader')?.setAttribute('hidden','');
  let workspace;
  try { workspace = await cloud.initialize(); }
  catch (error) {
    stopLoading();
    loginMessage.textContent = error.message;
    document.querySelector('#google-login').hidden = false;
    document.querySelector('#login-retry').hidden = false;
    return;
  }
  stopLoading();
  if (workspace.mode === 'login') {
    loginMessage.textContent = 'Entre com sua conta Google para abrir suas tarefas.';
    document.querySelector('#google-login').hidden = false;
    return;
  }
  const STORAGE_KEY = workspace.key;
  const workflow = globalThis.FlowWorkflow;
  const $ = (selector) => document.querySelector(selector);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uuid = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const addDays = (n) => { const date = new Date(); date.setDate(date.getDate()+n); return localDate(date); };
  const dateLabel = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','') : 'Sem data';
  const secondsLabel = (total) => [Math.floor(total/3600),Math.floor(total%3600/60),total%60].map(x=>String(x).padStart(2,'0')).join(':');
  const nameOfStatus = {inbox:'A classificar',todo:'A fazer',doing:'Em andamento',waiting:'Aguardando',done:'Concluída'};
  const sessionSeconds = t => (t.sessions||[]).reduce((sum,s) => sum+Math.max(0, Math.floor(((s.end||Date.now())-s.start)/1000)),0);
  const active = t => !!t.startedAt;
  const escapeIcs = str => String(str||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const validGmailUrl = value => {try {const url = new URL(value);return url.protocol==='https:' && url.hostname==='mail.google.com' ? url.href : ''} catch {return ''}};

  function seed(){
    const ps=globalThis.FlowAreas.defaults();
    const task=(id,title,project,plannedAfter,dueAfter,description,subs=[])=>({id,title,project,status:'todo',priority:'medium',plannedDate:addDays(plannedAfter),plannedTime:'',dueDate:addDays(dueAfter),description,subtasks:subs.map(text=>({id:uuid(),text,done:false})),sessions:[],startedAt:null,gmailUrl:'',gmailSubject:'',gmailSender:'',createdAt:Date.now(),completedAt:null});
    const ts=[
      task('t1','Conferir carga horária docente', 'carga',1,4,'Conferir os lançamentos da competência, validar os ajustes e preparar retorno à coordenação.',['Conferir lançamentos','Validar divergências','Responder ao setor']),
      task('t2','Revisar turmas com baixa ocupação','oferta',2,5,'Revisar os dados de ocupação e encaminhar ajustes necessários.',['Conferir painel de ocupação','Identificar turmas prioritárias']),
      task('t3','Analisar resultados da Avaliação Institucional','cpa',5,8,'Revisar os indicadores e organizar uma síntese para os setores envolvidos.'),
      task('t4','Acompanhar devolutivas pendentes','suporte',3,6,'Verificar demandas operacionais aguardando retorno dos setores.')
    ];
    ts[0].priority='high';ts[1].status='doing';ts[1].priority='high';ts[3].status='waiting';
    return {version:1,projects:ps,tasks:ts,preferences:{reminderDays:1,alerts:[true,true,true,false]}};
  }
  function load(){try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));if(raw?.version===1 && Array.isArray(raw.projects)&&Array.isArray(raw.tasks))return raw}catch{}return seed()}
  let db=workflow.normalize(workspace.mode === 'cloud' ? workspace.data || {version:1,projects:globalThis.FlowAreas.defaults(),tasks:[],preferences:{}} : load());
  workflow.reconcile(db);
  db.initiatives=Array.isArray(db.initiatives)?db.initiatives:[];
  const expandedDemands=new Set();
  let view={page:workspace.resumePage||'esteira',focusId:null,selectedId:db.tasks[0]?.id||null,projectFilter:'all',statusFilter:'open',projectBoard:'all',hideDone:false,mailSelected:null,weekOffset:0,timePeriod:'week',timeOffset:0,aiMode:'improve',aiSuggestion:null,aiLoading:false};
  let accessToken='';
  let toastTimeout;
  const persist=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(db));cloud.queue(db);globalThis.FlowCalendar.schedule()}catch(e){notice('Não foi possível salvar os dados. Verifique o espaço disponível no navegador.')}};
  const findTask=id=>db.tasks.find(t=>t.id===id);
  const selectedTask=()=>findTask(view.selectedId)||db.tasks[0];
  const findProject=id=>[...db.projects,...(db.archivedProjects||[])].find(p=>p.id===id);
  const projectName=id=>findProject(id)?.name||'Sem área';
  const persistAndRender=()=>{persist();render()};
  const badge=(s)=>`<span class="pill ${s==='done'?'green':s==='doing'?'blue':s==='waiting'?'gold':''}">${html(nameOfStatus[s]||s)}</span>`;
  const button=(label,action,primary=false,extra='')=>`<button type="button" class="button ${primary?'primary':''} ${action==='advance-task'?'lane-advance':''}" data-action="${action}" ${extra}>${label}</button>`;
  const pageHead=(title,subtitle,right='')=>`<div class="page-head"><div><div class="eyebrow">FLOW / WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`;
  const selectedFilterTasks=()=>db.tasks.filter(t=>(view.projectFilter==='all'||t.project===view.projectFilter)&&(view.statusFilter==='all'||(view.statusFilter==='open'?t.status!=='done':workflow.stage(db,t)===view.statusFilter)));
  const projOption=(current='all',all=true,legacy=false)=>`${all?'<option value="all">Todas as áreas</option>':`<option value="" ${!current?'selected':''}>Escolha uma área</option>`}${db.projects.map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''}>${html(p.name)}</option>`).join('')}${(all?(db.archivedProjects||[]):legacy?(db.archivedProjects||[]).filter(p=>p.id===current):[]).map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''} ${!all?'disabled':''}>${html(p.name)} (anterior)</option>`).join('')}`;
  const statusOption=(s,includeInbox=false)=>Object.entries(nameOfStatus).filter(([key])=>includeInbox||key!=='inbox').map(([key,name])=>`<option value="${key}" ${s===key?'selected':''}>${name}</option>`).join('');
  function notice(text){const box=$('#toast');box.textContent=text;box.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>box.classList.remove('visible'),3400)}
  function titleRow(title, right=''){return `<div class="between"><h3 class="sectiontitle">${title}</h3>${right}</div>`}

  const countdown=ms=>{const seconds=Math.ceil(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`};
  const urgencyBadge=t=>{const u=workflow.urgency(t);return `<span class="urgency ${u.tone}">${html(u.label)}${t.dueDate&&t.status!=='done'?` · ${dateLabel(t.dueDate)}`:''}</span>`};
  const areaBadge=t=>`<span class="area-label"><i style="background:${html(/^#[a-f0-9]{6}$/i.test(findProject(t.project)?.color||'')?findProject(t.project).color:'#8998ae')}"></i>${html(projectName(t.project))}</span>`;
  const nextTask=()=>db.tasks.filter(t=>workflow.classified(db,t)&&['todo','doing'].includes(t.status)).sort(workflow.byDue)[0];
  const focusTask=()=>findTask(db.focus?.taskId)||db.tasks.find(t=>t.id===view.focusId&&t.status!=='done'&&workflow.classified(db,t))||nextTask()||db.tasks.filter(t=>t.status!=='done'&&workflow.classified(db,t)).sort(workflow.byDue)[0];
  const workflowTrail=()=>'<div class="workflow-trail"><span><b>01</b> Classificar</span><i>→</i><span><b>02</b> Organizar na esteira</span><i>→</i><span><b>03</b> Entrar em foco</span></div>';

  function linkedEmailTask(email){return db.tasks.find(t=>t.gmailThreadId===email.id||t.gmailCaptureId==='gmail-mobile-'+email.id||t.gmailUrl?.endsWith('#all/'+email.id));}
  function renderGmailReview(){
    const state=FlowGmailReview.info(),connected=!!cloud.gmailToken();
    const rows=state.emails.filter(email=>{const r=db.gmailReviews?.[email.id],t=linkedEmailTask(email);return !(r?.messageId===email.messageId&&['accepted','ignored'].includes(r.state))&&!(t?.gmailMessageId===email.messageId&&r?.state!=='pending')});
    return `<section class="card gmail-review-box"><div class="between"><h3 class="sectiontitle">Para revisar</h3><div class="row">${connected?button(state.loading?'Buscando…':'Atualizar e-mails','gmail-refresh',false,state.loading?'disabled':'')+button(state.analyzing?'Analisando…':'Analisar com Gemini','gmail-analyze',false,state.analyzing||!state.emails.length?'disabled':'')+button('Desconectar leitura','gmail-read-disconnect'):button('Conectar leitura do Gmail','gmail-read-connect',true)}</div></div><p class="smalltext muted">A leitura consulta a caixa de entrada. Ao analisar, o texto das últimas três mensagens é enviado ao Gemini, sem anexos. Você confirma cada demanda antes de incluí-la na esteira.</p>${state.error?`<p class="sync-error" role="alert">${html(state.error)}</p>`:''}<div class="gmail-review-grid">${rows.map(email=>{const sender=FlowGmailReview.address(email.sender).toLowerCase(),color=/^#[a-f0-9]{6}$/i.test(db.gmailSenderColors?.[sender]||'')?db.gmailSenderColors[sender]:'',review=db.gmailReviews?.[email.id],current=review?.messageId===email.messageId?review:null,existing=linkedEmailTask(email);return `<article class="gmail-review-card" ${color?`style="border-left:4px solid ${color};background:${color}14"`: ''}><h3>${html(email.subject)}</h3><p class="smalltext muted">${html(email.sender)} · ${new Date(email.date).toLocaleDateString('pt-BR')}</p>${existing?'<span class="pill">Nova resposta · demanda já vinculada</span>':''}<p class="gmail-summary">${html(current?.summary||email.snippet||'Sem texto disponível.')}</p>${current?.alert?`<p class="review-alert">${html(current.alert)}</p>`:''}${current?.needsReview?'<p class="smalltext muted">Confira a classificação sugerida.</p>':''}<label class="sender-color-label">Cor deste remetente <input type="color" data-sender-color="${html(sender)}" value="${color||'#507ee9'}" /></label>${email.truncated?'<p class="smalltext muted">Análise limitada às últimas mensagens e a 12 mil caracteres.</p>':''}<form data-email-review="${html(email.id)}"><label class="field">Título da demanda<input name="title" maxlength="180" required value="${html(current?.title||email.subject.slice(0,180))}" /></label><div class="detail-grid"><label class="field">Área${!current?'<small>Escolha uma área ou analise com Gemini</small>':''}<select name="project" required>${projOption(current?.areaId||existing?.project||'',false)}</select></label><label class="field">Prazo final<input name="dueDate" type="date" required value="${html(workflow.validDate(current?.dueDate)?current.dueDate:existing?.dueDate||'')}" /></label></div>${current?.dateEvidence?`<p class="smalltext muted">Trecho do prazo: “${html(current.dateEvidence)}”</p>`:''}<label class="archive-choice"><input type="checkbox" name="archive" checked> Arquivar no Gmail após salvar</label><div class="row"><button type="button" class="button" data-reply-email="${html(email.id)}">Responder</button><button type="submit" class="button primary">${existing?'Atualizar demanda':'✓ Incluir na esteira'}</button><button type="button" class="button" data-ignore-email="${html(email.id)}">Ignorar</button><a class="button" target="_blank" rel="noopener noreferrer" href="${html(email.gmailUrl)}">Abrir Gmail</a></div></form></article>`}).join('')||`<p class="muted smalltext">${state.loading?'Carregando e-mails…':connected?'Clique em Atualizar e-mails para buscar mensagens, ou todas as mensagens carregadas já foram revisadas.':'Conecte sua conta para revisar os e-mails aqui.'}</p>`}${db.tasks.filter(t=>workflow.stage(db,t)==='inbox').map(t=>`<article class="gmail-review-card"><span class="pill">${t.gmailUrl?'E-mail vinculado':'Entrada manual'}</span><h3 style="margin-top:10px">${html(t.title)}</h3><p class="gmail-summary">${html(t.description||'')}</p><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}</div><div class="row" style="margin-top:12px">${button('Classificar →','classify-task',true,`data-id="${html(t.id)}"`)}${button('Detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div></article>`).join('')}</div>${state.nextPage?button('Carregar mais','gmail-more'):''}</section>`;
  }
  function renderInbox(){
    return pageHead('Entrada','Revise e-mails e registros manuais antes de incluí-los na esteira.',`<div class="row">${button('Conectar celular','gmail-mobile')}${button('Desconectar celular','gmail-mobile-revoke')}${button('+ Adicionar entrada','new-task',true)}</div>`)+workflowTrail()+renderGmailReview();
  }

  function renderPipeline(){
    const open=db.tasks.filter(t=>t.status!=='done'), today=localDate();
    const inbox=open.filter(t=>workflow.stage(db,t)==='inbox').length;
    const late=open.filter(t=>workflow.classified(db,t)&&t.dueDate<today).length;
    const dueToday=open.filter(t=>workflow.classified(db,t)&&t.dueDate===today).length;
    const focus=findTask(db.focus?.taskId), next=focus||nextTask();
    const visible=db.tasks.filter(t=>view.projectBoard==='all'||t.project===view.projectBoard).sort(workflow.byDue);
    const lanes=[['inbox','A classificar','Definir área e data'],['todo','A fazer','Próximas demandas'],['doing','Em andamento','Trabalho iniciado'],['waiting','Aguardando','Depende de um retorno'],['done','Concluídas','Trabalho entregue']].filter(([status])=>!view.hideDone||status!=='done').map(([status,title,subtitle])=>{
      const tasks=visible.filter(t=>workflow.stage(db,t)===status);
      return `<section class="pipeline-lane" data-stage="${status}"><div class="lanehead"><span>${title}</span><span class="lane-count">${tasks.length}</span></div><p class="lane-subtitle">${subtitle}</p>${tasks.map(t=>`<article class="pipeline-task ${active(t)?'in-focus':''}"><details class="demand-accordion" data-demand="${html(t.id)}" ${expandedDemands.has(t.id)?'open':''}><summary><strong>${html(t.title)}</strong>${areaBadge(t)}</summary><div class="demand-body"><div class="task-meta">${urgencyBadge(t)}</div>${active(t)?'<span class="focus-indicator">● Em foco agora</span>':''}${validGmailUrl(t.gmailUrl)?`<button type="button" class="button small pipeline-gmail" data-open-email="${html(t.id)}" aria-label="Abrir Gmail" title="Abrir e-mail no Gmail"><img src="./assets/gmail.svg" alt="" width="18" height="14"></button>`:''}<div class="pipeline-actions">${status==='inbox'?button('Classificar','classify-task',false,`data-id="${html(t.id)}"`):status!=='done'?button(active(t)?'Abrir foco':'Focar','focus-task',false,`data-id="${html(t.id)}"`):'<span class="completed-label">✓ Entregue</span>'}${button('Detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div><div class="stage-actions">${['doing','waiting','done'].includes(status)?button('← Retornar','return-task',false,`data-id="${html(t.id)}"`):''}${status!=='done'?button(status==='inbox'?'Classificar →':status==='waiting'?'Concluir →':'Avançar →','advance-task',false,`data-id="${html(t.id)}"`):''}</div>${status!=='inbox'?`<select class="lane-move" data-move-task="${html(t.id)}" aria-label="Mover ${html(t.title)} para outra etapa"><option value="">Mover etapa…</option>${Object.entries(nameOfStatus).filter(([key])=>key!=='inbox'&&key!==status).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select>`:''}</div></details></article>`).join('')||'<div class="lane-empty">Nenhuma demanda aqui.</div>'}</section>`;
    }).join('');
    const direction='<ol class="pipeline-direction" aria-label="Fluxo da esquerda para a direita">'+['Classificar','Preparar','Executar','Aguardar','Entregar'].filter((_,i)=>!view.hideDone||i<4).map((label,i)=>`<li><b>${String(i+1).padStart(2,'0')}</b><span>${label}</span>${i<4?'<i aria-hidden="true">→</i>':'<i aria-hidden="true">✓</i>'}</li>`).join('')+'</ol>';
    return pageHead('Uma esteira. Todas as demandas.','Da entrada à entrega, um fluxo da esquerda para a direita.')+`<div class="pipeline-summary"><button data-page="entrada"><span>A classificar</span><strong>${inbox}</strong></button><div><span>Para hoje</span><strong>${dueToday}</strong></div><div class="${late?'has-late':''}"><span>Atrasadas</span><strong>${late}</strong></div><button data-page="foco"><span>${focus?'Seu foco':'Próximo foco'}</span><strong class="summary-task">${html(next?.title||'Escolha uma demanda')}</strong><small>${focus?'Abrir sessão →':'Entrar em foco →'}</small></button></div><div class="pipeline-toolbar"><div><h3 class="sectiontitle">Esteira comum</h3><p>Avance a demanda pelas etapas. Datas mais próximas aparecem primeiro.</p></div><div class="pipeline-filter-actions">${button(view.hideDone?'Mostrar concluídas':'Ocultar concluídas','toggle-done',false,`aria-pressed="${view.hideDone}"`)}<label class="field">Área<select id="board-filter" class="filterselect">${projOption(view.projectBoard)}</select></label></div></div><div class="pipeline-board ${view.hideDone?'hide-done':''}">${direction}${lanes}</div><p class="board-footnote">Aguardando é usado quando há um retorno pendente. Você também pode concluir a tarefa diretamente em Detalhes ou Mover etapa.</p>`;
  }
  function renderFocus(){
    const t=focusTask(), f=db.focus, working=f?.phase==='work', paused=f&&!f.endsAt&&f.phase!=='ready';
    const candidates=db.tasks.filter(t=>workflow.classified(db,t)&&t.status!=='done').sort(workflow.byDue);
    const options=candidates.map(x=>`<option value="${html(x.id)}" ${x.id===t?.id?'selected':''}>${html(x.title)} · ${html(projectName(x.project))}</option>`).join('');
    const title=f?.phase==='break'?'Hora de respirar.':f?.phase==='ready'?'Pronto para continuar?':'Agora, só esta tarefa.';
    const controls=!t?button('Capturar demanda','new-task',true):working&&f.endsAt?button('Ⅱ Pausar foco','focus-pause',true):f?.phase==='break'?`${f.endsAt?button('Ⅱ Pausar descanso','focus-pause'):button('Retomar descanso','break-resume',true)}${button('Começar próximo ciclo','focus-start')}`:button(paused?'Retomar foco':'Começar ciclo','focus-start',true);
    return pageHead('Foco','Uma tarefa por vez. Tempo para trabalhar, tempo para descansar.')+`<div class="focus-layout"><section class="card focus-main ${f?.phase==='break'?'on-break':''}"><div class="eyebrow">${f?.phase==='break'?'PAUSA':f?.phase==='ready'?'CICLO CONCLUÍDO':paused?'FOCO PAUSADO':'SEU ESPAÇO DE CONCENTRAÇÃO'}</div><h2>${title}</h2>${t?`<div class="focus-task-title">${html(t.title)}</div><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}</div>`:'<p class="muted">Classifique uma demanda por área e data para começar.</p>'}<div class="focus-ring"><div><span class="focus-countdown" data-countdown>${countdown(workflow.remaining(db))}</span><small>${f?.phase==='break'?'descanso':f?.phase==='ready'?'comece quando estiver pronto':paused?'ciclo pausado':'minutos de foco'}</small></div></div><div class="focus-controls">${controls}</div>${t?`<div class="focus-secondary">${button('✓ Concluir tarefa','focus-complete')}${f?button('Trocar tarefa','focus-change'):button('Ver detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div><div class="focus-total"><span>Tempo trabalhado <b data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</b></span><span><b>${t.focusCycles||0}</b> ciclos completos</span></div>`:''}<p class="focus-caption">Ao terminar o foco, o descanso começa. O próximo ciclo de trabalho depende de você.</p></section><aside class="focus-aside"><section class="card"><h3 class="sectiontitle">Sua tarefa</h3><label class="field">Escolher demanda<select id="focus-task-select" ${f?'disabled':''}>${options||'<option>Nenhuma demanda classificada</option>'}</select></label>${t?.subtasks.length?`<div class="focus-subtasks">${t.subtasks.map(s=>`<label class="subtask ${s.done?'done':''}"><input type="checkbox" data-focus-sub="${html(s.id)}" ${s.done?'checked':''}><span>${html(s.text)}</span></label>`).join('')}</div>`:'<p class="muted smalltext">O detalhe da tarefa reúne anotações, e-mail e histórico.</p>'}${t?button('Abrir detalhes','task-detail',false,`data-task="${html(t.id)}"`):button('Classificar entrada','show-inbox')}</section><section class="card"><h3 class="sectiontitle">Seu ritmo</h3><div class="rhythm-fields"><label class="field">Foco (min)<input id="focus-minutes" type="number" min="1" max="180" step="1" value="${db.preferences.focusMinutes}" /></label><label class="field">Pausa (min)<input id="break-minutes" type="number" min="1" max="60" step="1" value="${db.preferences.breakMinutes}" /></label></div><p class="muted smalltext">Alterações valem para o próximo período. O tempo atual é preservado.</p></section><div class="focus-principle"><span>◉</span><p>As demandas são muitas.<br><b>A sua atenção é uma.</b></p></div></aside></div>`;
  }

  function renderTasks(){
    const filtered=selectedFilterTasks();
    const t=filtered.find(x=>x.id===view.selectedId)||filtered[0];
    if(!t)return pageHead('Detalhe da tarefa','Selecione uma demanda na esteira.',button('← Esteira','show-pipeline'));
    view.selectedId=t.id;
    const len=t.sessions.length, last=t.sessions.filter(s=>s.end).slice(-3).reverse();
    const history=last.length?last.map(s=>`<div class="time-record">${new Date(s.start).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${secondsLabel(Math.floor((s.end-s.start)/1000))}</div>`).join(''):'<p class="muted smalltext">Nenhuma sessão encerrada ainda.</p>';
    const origin=t.gmailUrl?`<div class="originbox"><b>✉ E-mail vinculado</b><div>${html(t.gmailSubject||'Conversa original')}</div><div style="margin-top:6px">${html(t.gmailSender)}</div><button class="button small" data-action="open-email" type="button">↗ Abrir conversa original</button></div>`:'';
    const result=view.aiSuggestion?`<div class="ai-suggestion"><h4>✧ Sugestão recebida do Gemini</h4><textarea id="ai-output" aria-label="Texto gerado para revisão">${html(view.aiSuggestion.text)}</textarea><div class="row" style="flex-wrap:wrap">${button(view.aiSuggestion.mode==='subtasks'?'Criar subtarefas':'Aplicar à descrição','apply-ai',true)}${button('Copiar texto','copy-ai')}${button('Descartar','discard-ai')}</div></div>`:'';
    const detail=`<section class="demand-detail"><div class="between"><span class="pill blue">${html(projectName(t.project))}</span>${badge(workflow.stage(db,t))}</div><h2 class="detail-title">${html(t.title)}</h2>${!workflow.classified(db,t)&&t.status!=='done'?`<div class="classification-hint">Defina a área e a data para colocar esta demanda na esteira. ${button('Classificar','classify-task',true,`data-id="${html(t.id)}"`)}</div>`:''}
      <div class="detail-grid">
        <label class="field">Título<input id="edit-title" value="${html(t.title)}" maxlength="180" /></label>
        <label class="field">Área<select id="edit-project">${projOption(t.project,false,true)}</select></label>
        <label class="field">Situação<select id="edit-status">${statusOption(t.status)}</select></label>
        <div class="field">Urgência pela data<div class="urgency-line">${urgencyBadge(t)}</div></div>
        <label class="field">Data de execução<input id="edit-planned" type="date" value="${html(t.plannedDate||'')}" /></label>
        <label class="field">Hora planejada<input id="edit-time" type="time" value="${html(t.plannedTime||'')}" /></label>
        <label class="field">Prazo final<input id="edit-due" type="date" value="${html(t.dueDate||'')}" /></label>
        <label class="field">Agenda Google (.ics)<button class="button" style="margin-top:6px;display:block;width:100%" data-action="export-ics" type="button">↧ Exportar evento</button></label>
      </div>
      <div class="timerbox"><div class="label">◷ TEMPO DE TRABALHO</div><div class="timer-value" data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</div><div class="timer-meta">${active(t)?'● Ciclo de foco em andamento':'Tempo registrado de trabalho'} · ${len} ${len===1?'sessão':'sessões'} no histórico</div><div class="actionbar">${active(t)?button('Ⅱ Pausar','pause',true):button('Entrar em foco','start',true)}${t.status==='done'?button('← Reabrir tarefa','return-task',false,`data-id="${html(t.id)}"`):button('✓ Concluir','complete')}${t.gmailUrl?button('↗ Voltar ao Gmail','open-email'):''}${t.gmailThreadId?button('Responder e-mail','reply-task'):''}</div></div>
      ${titleRow('Subtarefas',`<span class="pill">${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length}</span>`)}${t.subtasks.map(s=>`<label class="subtask ${s.done?'done':''}"><input type="checkbox" data-sub="${html(s.id)}" ${s.done?'checked':''} /><span>${html(s.text)}</span><button class="button small ghost right" type="button" data-delete-sub="${html(s.id)}" aria-label="Excluir subtarefa">✕</button></label>`).join('')||'<div class="muted smalltext" style="margin-top:10px">Ainda não há subtarefas.</div>'}
      <form class="inline-add" id="sub-form"><input name="title" required placeholder="+ Adicionar subtarefa" maxlength="180"/><button class="button small" type="submit">Adicionar</button></form>
      ${origin}<div class="divider"></div>
      <div class="ai-head"><h3 class="sectiontitle">Descrição e assistente Gemini</h3><span class="pill blue">✧ IA</span></div><label class="field">Contexto e anotações<textarea id="edit-description" rows="5" maxlength="7500">${html(t.description)}</textarea></label>
      <div class="ai-control"><select id="ai-mode" aria-label="Tipo de auxílio"><option value="improve" ${view.aiMode==='improve'?'selected':''}>Melhorar descrição</option><option value="reply" ${view.aiMode==='reply'?'selected':''}>Criar resposta ao setor</option><option value="subtasks" ${view.aiMode==='subtasks'?'selected':''}>Sugerir subtarefas</option></select><button type="button" class="button primary" data-action="gemini" ${view.aiLoading?'disabled':''}>${view.aiLoading?'Consultando…':'✧ Gerar com Gemini'}</button></div>
      <div class="smalltext muted" style="margin-top:9px">A descrição é enviada à API Gemini somente quando você clicar no botão. Revise o texto antes de aplicar ou enviar.</div>${result}
      <div class="divider"></div>${titleRow('Histórico do cronômetro')}<div style="margin-top:10px">${history}</div><div class="actionbar" style="justify-content:flex-end">${button('Excluir tarefa','delete-task',false,'') }</div>
    </section>`;
    return pageHead('Detalhe da tarefa','Área e data classificam a demanda. A execução acontece na esteira comum.',button('← Esteira','show-pipeline'))+`<div class="task-detail-only">${detail}</div>`;
  }
  function renderArea(){
    const area=findProject(view.areaId);if(!area)return pageHead('Área não encontrada','Volte às áreas.',button('← Áreas','show-areas'));
    const tasks=db.tasks.filter(t=>t.project===area.id),projects=(db.initiatives||[]).filter(p=>p.areaId===area.id);
    const taskRows=list=>list.map(t=>`<button class="task-list-item" data-task="${html(t.id)}"><strong>${html(t.title)}</strong><div class="status-line">${badge(workflow.stage(db,t))}${urgencyBadge(t)}</div></button>`).join('')||'<p class="smalltext muted">Nenhuma tarefa aqui ainda.</p>';
    return pageHead(area.name,'Tarefas e projetos desta área. Todas as demandas seguem pela esteira.',`<div class="row">${button('← Áreas','show-areas')}${button('+ Criar projeto','new-initiative')}${button('+ Nova tarefa','area-new-task',true)}</div>`)+`<section class="card"><h3 class="sectiontitle">Tarefas da área</h3>${taskRows(tasks.filter(t=>!projects.some(p=>p.id===t.initiativeId)))}</section><div class="area-projects">${projects.map(p=>`<section class="card"><div class="between"><h3 class="sectiontitle">${html(p.name)}</h3>${button('+ Nova tarefa','initiative-new-task',false,`data-id="${html(p.id)}"`)}</div>${p.description?`<p class="smalltext muted">${html(p.description)}</p>`:''}${taskRows(tasks.filter(t=>t.initiativeId===p.id))}</section>`).join('')}</div>`;
  }
  function newInitiative(){const areaId=view.areaId;if(!findProject(areaId))return;promptModal({title:'Novo projeto',subtitle:'Agrupe as tarefas desta área em um projeto.',content:'<label class="field">Nome do projeto<input name="name" required maxlength="100" /></label><label class="field">Descrição<textarea name="description" maxlength="2000"></textarea></label>',onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;db.initiatives??=[];db.initiatives.push({id:uuid(),areaId,name,description:String(data.get('description')||''),createdAt:Date.now()});persistAndRender();return true},ok:'Criar projeto'})}
  function renderProjects(){
    const cards=db.projects.map((p,index)=>{const color=/^#[a-f0-9]{6}$/i.test(p.color||'')?p.color:'#507ee9';const group=db.tasks.filter(t=>t.project===p.id),closed=group.filter(t=>t.status==='done').length,percent=group.length?Math.round(closed*100/group.length):0;return `<div class="project-order-card"><button class="projectcard" style="--area-tint:${color}14;--area-color:${color}" data-project="${html(p.id)}"><div class="between"><div class="projecticon" style="background:${color}18;color:${color}">▦</div><span class="pill">${group.length} tarefas</span></div><strong>${html(p.name)}</strong><p>${group.length-closed} abertas · ${closed} concluídas</p><div class="progressbar"><i style="width:${percent}%;background:${color}"></i></div></button><div class="area-order-actions"><button type="button" class="button small" data-area-up="${html(p.id)}" aria-label="Mover ${html(p.name)} para cima" ${index===0?'disabled':''}>↑</button><button type="button" class="button small" data-area-down="${html(p.id)}" aria-label="Mover ${html(p.name)} para baixo" ${index===db.projects.length-1?'disabled':''}>↓</button></div></div>`}).join('');
    return pageHead('Áreas','De onde vêm as demandas. Todas seguem pela mesma esteira.',button('+ Criar área','new-project',true))+`<div class="projectgrid">${cards||'<div class="empty">Nenhuma área criada.</div>'}</div><div class="notice" style="margin-top:20px">Use as áreas para classificar e consultar. ${button('Abrir esteira comum','show-pipeline')}</div>`;
  }
  function renderCalendar(){
    const today=new Date();today.setHours(12,0,0,0);const dow=(today.getDay()+6)%7;
    const monday=new Date(today);monday.setDate(today.getDate()-dow+view.weekOffset*7);
    const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d});
    const range=`${days[0].toLocaleDateString('pt-BR',{day:'numeric',month:'short'})} – ${days[6].toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})}`;
    const from=new Date(days[0]);from.setHours(0,0,0,0);const until=new Date(from);until.setDate(until.getDate()+7);
    globalThis.FlowCalendar.showRange(from.toISOString(),until.toISOString());
    const calendar=globalThis.FlowCalendar.info();
    const connection=calendar.connected?`<div class="calendar-compact-row"><details><summary>● Google Agenda conectado</summary><p>Compromissos da agenda principal e tarefas do Flow. Atualiza enquanto o Flow está aberto.</p>${button('Desconectar','calendar-disconnect')}</details>${button(calendar.reading||calendar.status==='syncing'?'Sincronizando…':'Sincronizar','calendar-sync')}</div>`:`<div class="calendar-compact-row"><span>Google Agenda</span>${button('Conectar','calendar-connect',true)}</div>`;
    return pageHead('Agenda','Suas tarefas e os compromissos do Google no mesmo calendário.',`<div class="agenda-head-actions"><section class="calendar-connection">${connection}${calendar.error?`<p class="sync-error">${html(calendar.error)}</p>`:''}${calendar.readError?`<p class="sync-error">${html(calendar.readError)}</p>`:''}</section></div>`)+`<section class="agenda-week-nav"><div class="calendar-toolbar"><strong>${range}</strong><div class="row">${button('←','week-previous')}${button('Semana atual','week-reset')}${button('→','week-next')}</div></div></section><div class="calendar-grid">${days.map((d,i)=>{const date=localDate(d);const matches=db.tasks.filter(t=>t.plannedDate===date).sort((a,b)=>(a.plannedTime||'').localeCompare(b.plannedTime||''));return `<div class="calendar-day"><small>${['SEG','TER','QUA','QUI','SEX','SÁB','DOM'][i]}</small><strong>${d.getDate()}</strong>${matches.map(t=>`<button data-task="${html(t.id)}" class="calendar-event"><time>${html(t.plannedTime||'Dia inteiro')}</time>${html(t.title)}</button>`).join('')}${calendar.events.filter(e=>{const start=new Date(d);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return e.start.date?e.start.date<localDate(end)&&e.end.date>date:new Date(e.start.dateTime)<end&&new Date(e.end.dateTime)>start}).map(e=>`<div class="calendar-event google-calendar-event"><time>${html(e.start.date?'Dia inteiro':new Date(e.start.dateTime).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))} · Google</time>${html(e.summary||'Sem título')}</div>`).join('')}</div>`}).join('')}</div><p class="board-footnote">O evento usa a <b>data de execução</b>. O <b>prazo final</b> permanece separado, na descrição. Sem horário, o evento ocupa o dia inteiro; com horário, usa a duração do seu ciclo de foco. A exportação .ics continua disponível nos detalhes da tarefa.</p>`;
  }
  function timeReport(){return globalThis.FlowTime.summarize(db,view.timePeriod,view.timeOffset)}
  function renderTime(){
    const report=timeReport(), duration=globalThis.FlowTime.duration;
    const last=new Date(report.end);last.setDate(last.getDate()-1);
    const range=report.start.toLocaleDateString('pt-BR')+(view.timePeriod==='day'?'':` — ${last.toLocaleDateString('pt-BR')}`);
    const peak=Math.max(...report.buckets.map(b=>b.ms),1);
    const bars=report.buckets.map(b=>`<div class="time-bar" title="${html(b.label)}: ${duration(b.ms)}"><span class="time-bar-value">${b.ms?Math.round(b.ms/60000)+'m':''}</span><i style="height:${b.ms?Math.max(2,b.ms/peak*135):0}px"></i><small>${html(b.label)}</small></div>`).join('');
    const areas=report.areas.map(a=>`<div class="time-area"><div class="between"><strong>${html(a.name)}</strong><span>${duration(a.ms)} · ${Math.round(a.ms/report.totalMs*100)}%</span></div><div class="progressbar"><i style="width:${a.ms/report.totalMs*100}%;background:${html(/^#[a-f0-9]{6}$/i.test(a.color)?a.color:'#8998ae')}"></i></div></div>`).join('');
    const tasks=report.tasks.map(t=>`<tr><td><button class="text-button" data-task="${html(t.id)}">${html(t.title)}</button></td><td>${html(t.area)}</td><td>${duration(t.ms)}</td><td>${t.sessions}</td></tr>`).join('');
    return pageHead('Gestão do Tempo','Entenda onde sua atenção foi investida.',button('Gerar relatório','time-report',true))+`<section class="card time-toolbar"><div class="time-periods" role="group" aria-label="Período da análise">${[['day','Dia'],['week','Semana'],['month','Mês']].map(([id,label])=>`<button type="button" class="button ${view.timePeriod===id?'primary':''}" data-time-period="${id}" aria-pressed="${view.timePeriod===id}">${label}</button>`).join('')}</div><strong class="time-range">${range}</strong><div class="row">${button('←','time-previous')}${button('Atual','time-current')}${button('→','time-next')}</div></section><div class="time-kpis"><section class="card"><span>Tempo trabalhado</span><strong id="time-total">${duration(report.totalMs)}</strong><small>Somente sessões de trabalho</small></section><section class="card"><span>Tarefas trabalhadas</span><strong>${report.tasks.length}</strong><small>Com tempo registrado no período</small></section><section class="card"><span>Maior dedicação</span><strong class="time-area-name">${html(report.areas[0]?.name||'Sem registros')}</strong><small>${report.areas[0]?duration(report.areas[0].ms):'Comece um ciclo de foco'}</small></section></div><div class="time-analysis"><section class="card"><h3 class="sectiontitle">${view.timePeriod==='day'?'Tempo por hora':'Tempo por dia'}</h3><div class="time-chart-scroll"><div class="time-chart" style="--bars:${report.buckets.length}" role="img" aria-label="${html(report.buckets.map(b=>b.label+': '+duration(b.ms)).join('; '))}">${bars}</div></div><p class="muted smalltext">${report.totalMs?'Cada barra representa o tempo efetivamente registrado.':'Nenhum tempo registrado neste período.'}</p></section><section class="card"><h3 class="sectiontitle">Distribuição por área</h3>${areas||'<div class="empty">As áreas aparecem conforme você trabalha nas tarefas.</div>'}</section></div><section class="card time-tasks"><div class="between"><h3 class="sectiontitle">Tempo por tarefa</h3><span class="pill">${report.sessionCount} sessões</span></div><div class="time-table-scroll"><table><thead><tr><th>Tarefa</th><th>Área</th><th>Tempo</th><th>Sessões</th></tr></thead><tbody>${tasks||'<tr><td colspan="4">Nenhuma sessão de trabalho no período.</td></tr>'}</tbody></table></div></section><p class="board-footnote report-note">Pausas ficam fora dos totais. Sessões que atravessam a meia-noite são divididas entre os dias. A análise usa o fuso horário deste dispositivo e a classificação atual de cada tarefa. Tempo de tarefas excluídas deixa de constar no relatório.</p>`;
  }
  function reportModal(){
    promptModal({title:'Gerar relatório de tempo',subtitle:'O relatório usa o período selecionado em Gestão do Tempo.',content:`<p>Inclui o total trabalhado e a distribuição por área e por tarefa.</p><div class="actionbar">${button('Baixar CSV','time-csv',true)}${button('Baixar PDF','time-pdf',true)}</div>`,onSubmit:()=>true,ok:'Fechar'});
  }
  function accountModal(){
    const account=cloud.info();
    if(account.mode==='cloud')promptModal({title:'Sua conta Google',subtitle:account.user.email||'Conta conectada',content:`<p>Seus dados ficam no Supabase, privados para esta conta. Uma cópia fica neste navegador.</p><p>${html(account.error||({saved:'Salvo na nuvem.',pending:'Alterações aguardando salvamento.',saving:'Salvando na nuvem.'}[account.status]||''))}</p><div class="actionbar">${button('Tentar salvar agora','cloud-retry')}${button('Carregar versão da nuvem','cloud-reload')}${button('Trazer tarefas deste navegador','import-local')}${button('Exportar backup','export-data')}${button('Sair','sign-out')}</div>`,onSubmit:()=>true,ok:'Fechar'});
    else promptModal({title:'Entrar com Google',subtitle:'A conexão com sua conta ainda precisa ser ativada.',content:'<p>Configure o Supabase e o provedor Google na Vercel para ter login e armazenamento privado na nuvem.</p><a class="button primary" href="https://github.com/rafaelvalada-droid/Flow/blob/main/docs/ATIVACAO-GOOGLE.md" target="_blank" rel="noopener noreferrer">Ver instruções de ativação</a>',onSubmit:()=>true,ok:'Fechar'});
  }
  function importLocal(){
    let legacy;try{legacy=JSON.parse(localStorage.getItem('flow.workspace.v1'))}catch{}
    if(legacy?.version!==1||!Array.isArray(legacy.tasks)||!Array.isArray(legacy.projects)){notice('Nenhuma base anterior encontrada neste navegador. Você também pode importar um backup.');return}
    if(!confirm('Acrescentar as tarefas deste navegador à conta Google atual? Os dados locais serão preservados.'))return;
    const imported=workflow.normalize(structuredClone(legacy));workflow.reconcile(imported);
    if(imported.focus)workflow.cancel(imported,imported.focus.taskId);
    const areaIds=new Map();
    for(const p of [...imported.projects,...(imported.archivedProjects||[])]){
      const current=findProject(p.id);let id=p.id;
      if(current&&current.name!==p.name)id=uuid();
      if(!current||id!==p.id)db.projects.push({...p,id});
      areaIds.set(p.id,id);
    }
    let count=0;
    for(const task of imported.tasks){
      if(db.tasks.some(t=>JSON.stringify(t)===JSON.stringify(task)||(task.gmailCaptureId&&t.gmailCaptureId===task.gmailCaptureId)))continue;
      db.tasks.push({...task,id:findTask(task.id)?uuid():task.id,project:areaIds.get(task.project)||task.project});count++;
    }
    persistAndRender();closeModal();notice(`${count} tarefas acrescentadas. Cronômetros importados ficam pausados.`);
  }
  function updateAccount(){
    const account=cloud.info(), labels={saved:'Salvo na nuvem',pending:'Salvamento pendente',saving:'Salvando…',error:'Falha ao salvar',conflict:'Conflito de alterações'};
    $('#account-button').textContent=account.mode==='cloud'?(labels[account.status]||'Conta Google'):'Entrar com Google';
    $('#account-button').title=account.error||account.user?.email||'Conectar sua conta Google';
    $('.sidebar-foot strong').textContent=account.user?.email||'Meu workspace';
    $('.sidebar-foot small').textContent=account.mode==='cloud'?'Google · Supabase':'Flow · neste navegador';
  }
  async function composeReply(threadId){
    try{const email=await FlowGmailReview.replyContext(threadId),me=cloud.info().user?.email?.toLowerCase(),sender=FlowGmailReview.address(email.sender),recipient=sender.toLowerCase()===me?FlowGmailReview.address(email.recipient):sender;
    promptModal({title:'Responder e-mail',subtitle:email.subject,content:`<label class="field">Para<input name="to" type="email" required value="${html(recipient)}" /></label><label class="field">Resposta<textarea name="message" required rows="8" maxlength="20000"></textarea></label><label class="field">Anexos · até 10 MB no total<input type="file" name="attachments" multiple /></label><p class="smalltext muted">O botão Enviar resposta envia o e-mail pela sua conta Gmail.</p><p id="reply-status" role="status"></p>`,onSubmit:()=>false,ok:'Enviar resposta'});
    const form=$('#active-modal-form');let sending=false;
    form.addEventListener('submit',async event=>{event.preventDefault();if(sending)return;sending=true;const send=form.querySelector('[type="submit"]');send.disabled=true;const status=form.querySelector('#reply-status');status.textContent='Enviando…';
     try{await FlowGmailReview.reply(email,form.elements.to.value,form.elements.message.value,[...form.elements.attachments.files]);closeModal();notice('Resposta enviada pelo Gmail.');}catch(error){status.textContent=error.message;}finally{sending=false;send.disabled=false;}
    });}catch(error){notice(error.message)}
  }
  function renderAlerts(){
    const rows=[['Lembrar antes do vencimento','Planejado para a etapa de envio de e-mails.'],['Acompanhar tarefas atrasadas','Alerta para tarefas cujo prazo final já passou.'],['Resumo diário de tarefas','Consolidar as demandas previstas para cada dia.'],['Resumo semanal por área','Entregar um resumo de pendências por área.']];
    return pageHead('Alertas','Preferências de lembretes e acompanhamento.')+`<section class="card">${rows.map(([title,desc],i)=>`<div class="alertrow"><div><strong>${title}</strong><small>${desc}</small></div><button class="switch ${db.preferences.alerts[i]?'on':''}" data-alert="${i}" role="switch" aria-checked="${db.preferences.alerts[i]}" aria-label="${title}"></button></div>`).join('')}<label class="field" style="max-width:310px;margin-top:19px">Antecedência do lembrete<select id="reminder-days">${[1,2,3,7].map(n=>`<option value="${n}" ${db.preferences.reminderDays===n?'selected':''}>${n} ${n===1?'dia':'dias'} antes</option>`).join('')}</select></label></section><div class="notice" style="margin-top:15px">Esta tela já grava suas preferências. O envio automático por e-mail <b>ainda não está ativado</b>; ele dependerá da autenticação, do servidor e do serviço de notificações.</div>`;
  }
  function tick(){
    if(workflow.reconcile(db)){persist();render();notice(db.focus?.phase==='break'?'Ciclo concluído. Hora de uma pausa.':'Pausa concluída. Comece o próximo ciclo quando estiver pronto.');return}
    const focus=db.focus, el=$('#active-clock');
    if(el){el.classList.toggle('running',!!focus?.endsAt);el.textContent=focus?`${focus.phase==='work'?'◉ Foco':focus.phase==='break'?'◷ Pausa':'✓ Próximo ciclo'} · ${countdown(workflow.remaining(db))}`:'◉ Entrar em foco'}
    document.querySelectorAll('[data-time]').forEach(x=>{const t=findTask(x.dataset.time);if(t)x.textContent=secondsLabel(sessionSeconds(t))});
    document.querySelectorAll('[data-countdown]').forEach(x=>x.textContent=countdown(workflow.remaining(db)));
    const ring=$('.focus-ring');if(ring)ring.style.setProperty('--progress',`${focus?Math.min(100,100*(1-workflow.remaining(db)/(focus.durationMs||1))):0}%`);
    if(view.page==='foco')document.title=`${focus?countdown(workflow.remaining(db))+' · ':''}Flow — Foco`;
  }
  function render(){
    const names={entrada:'Entrada',esteira:'Esteira',foco:'Foco',tarefas:'Tarefa',projetos:'Áreas',agenda:'Agenda',gmail:'Gmail',alertas:'Alertas',tempo:'Gestão do Tempo',area:'Área'};
    $('#location-label').textContent=names[view.page];document.title=`Flow — ${names[view.page]}`;
    document.querySelectorAll('#sidebar-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===view.page));
    const inbox=db.tasks.filter(t=>workflow.stage(db,t)==='inbox').length;
    const count=$('#inbox-count');if(count){count.textContent=inbox;count.hidden=!inbox}
    $('#screen').innerHTML=({entrada:renderInbox,esteira:renderPipeline,foco:renderFocus,tarefas:renderTasks,projetos:renderProjects,area:renderArea,agenda:renderCalendar,gmail:renderInbox,alertas:renderAlerts,tempo:renderTime})[view.page]();tick();if(view.page==='entrada')restoreEmailDrafts();
  }
  function stop(t){if(!t)return;if(db.focus?.taskId===t.id)workflow.pause(db);else workflow.cancel(db,t.id)}
  function start(t){
    if(!t)return;
    if(t.status==='done'){notice('Reabra a tarefa antes de iniciar um ciclo.');return}
    if(!workflow.classified(db,t)){classifyTask(t,()=>start(t));return}
    workflow.start(db,t.id);view.focusId=t.id;persist();openPage('foco');notice('Uma tarefa, um ciclo de foco.');
  }
  function complete(t){if(!t)return;workflow.cancel(db,t.id);t.status='done';t.completedAt=Date.now();persistAndRender();notice('Tarefa concluída. Tempo de trabalho preservado.')}
  function openPage(page){if(page==='gmail')page='entrada';if(!['entrada','esteira','foco','tarefas','projetos','agenda','gmail','alertas','tempo','area'].includes(page))return;view.page=page;view.aiSuggestion=null;render();document.querySelector('.screen').scrollTo(0,0);if(page==='entrada'&&cloud.gmailToken()&&!FlowGmailReview.info().loading)FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(db,persist))}
  function selectTask(id){if(view.page!=='tarefas')view.detailReturnPage=view.page;view.selectedId=id;view.projectFilter='all';view.statusFilter='all';openPage('tarefas')}
  function openGmail(t){const url=validGmailUrl(t?.gmailUrl);if(!url){notice('Não há um link válido do Gmail nesta tarefa.');return}window.open(url,'_blank','noopener,noreferrer')}
  function download(filename, content, type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportIcs(t){if(!t?.plannedDate){notice('Informe a data de execução antes de exportar o evento.');return}const d=t.plannedDate.replaceAll('-','');let start='',end='';if(t.plannedTime){const dt=new Date(`${t.plannedDate}T${t.plannedTime}:00`);start=`DTSTART:${dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;end=`DTEND:${new Date(dt.getTime()+30*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`}else{const next=new Date(`${t.plannedDate}T12:00:00`);next.setDate(next.getDate()+1);start=`DTSTART;VALUE=DATE:${d}`;end=`DTEND;VALUE=DATE:${localDate(next).replaceAll('-','')}`}const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flow Workspace//PT-BR//EN','BEGIN:VEVENT',`UID:${t.id}@flow.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,start,end,`SUMMARY:${escapeIcs(t.title)}`,`DESCRIPTION:${escapeIcs(t.description+(t.gmailUrl?'\nGmail: '+t.gmailUrl:''))}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');download(`flow-${t.id}.ics`,text,'text/calendar;charset=utf-8');notice('Evento .ics exportado. Importe o arquivo no Google Agenda.')}
  function promptModal({title,subtitle,content,onSubmit,ok='Salvar'}){
    const box=$('#modal-backdrop');box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${html(title)}"><h2>${html(title)}</h2><p>${html(subtitle)}</p><form id="active-modal-form">${content}<div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">${html(ok)}</button></div></form></div>`;box.classList.remove('hidden');box._submit=onSubmit;box.querySelector('input,select')?.focus();
  }
  const closeModal=()=>{$('#modal-backdrop').classList.add('hidden');$('#modal-backdrop').innerHTML=''};
  function newProject(){promptModal({title:'Nova área',subtitle:'Organize suas demandas em uma nova área.',content:`<label class="field">Nome da área<input name="name" required maxlength="70" placeholder="Ex.: Planejamento Acadêmico" /></label><label class="field">Cor<select name="color"><option value="#507ee9">Azul</option><option value="#9270d4">Violeta</option><option value="#2ca79a">Verde</option><option value="#dbab56">Dourado</option></select></label>`,onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;db.projects.push({id:uuid(),name,color:String(data.get('color'))});persistAndRender();notice('Área criada.');return true}})}
  function newTask(prefill={}){
    const isMail=!!prefill.gmailUrl, fromAgenda=view.page==='agenda',fromArea=view.page==='area';
    if(fromAgenda&&!prefill.plannedDate){const date=new Date();if(view.weekOffset){date.setDate(date.getDate()-(date.getDay()+6)%7+view.weekOffset*7)}prefill={...prefill,plannedDate:localDate(date)}}
    const content=`<label class="field">O que precisa ser feito?<input name="title" required maxlength="180" value="${html(prefill.title||'')}" placeholder="Ex.: Conferir folha docente" /></label><div class="classification-questions"><label class="field">1. Para onde vai?<select name="project">${projOption(prefill.project||'',false)}</select></label><label class="field">2. Qual o prazo final?<input type="date" name="dueDate" value="${html(prefill.dueDate||'')}" /></label></div><p class="smalltext muted">Se ainda não souber a área ou a data, salve na Entrada e classifique depois.</p><div class="classification-questions"><label class="field">Data de execução<input type="date" name="plannedDate" ${fromAgenda?'required':''} value="${html(prefill.plannedDate||'')}" /></label><label class="field">Hora de execução<input type="time" name="plannedTime" value="${html(prefill.plannedTime||'')}" /></label></div><p class="smalltext muted">A data de execução coloca a demanda na Agenda. Sem horário, aparece como dia inteiro. O prazo final permanece separado.</p><label class="field">Contexto (opcional)<textarea name="description" rows="3" maxlength="7500">${html(prefill.description||'')}</textarea></label>${isMail?`<div class="notice" style="margin-top:13px">✉ ${html(prefill.gmailSubject||prefill.gmailUrl)}</div>`:''}`;
    promptModal({title:isMail?'Incluir e-mail no Flow':'Nova demanda',subtitle:'Capture a demanda. Área e data colocam a tarefa na esteira.',content,onSubmit:data=>{
      const title=String(data.get('title')||'').trim();if(!title)return false;
      const t={id:uuid(),title,project:String(data.get('project')||''),status:'todo',priority:'medium',plannedDate:String(data.get('plannedDate')||''),plannedTime:String(data.get('plannedTime')||''),dueDate:String(data.get('dueDate')||''),description:String(data.get('description')||''),subtasks:[],sessions:[],startedAt:null,focusCycles:0,gmailUrl:validGmailUrl(prefill.gmailUrl||''),gmailSubject:String(prefill.gmailSubject||''),gmailSender:String(prefill.gmailSender||''),createdAt:Date.now(),completedAt:null,initiativeId:prefill.initiativeId||null};
      if(fromArea&&t.project!==view.areaId){notice('Use a área deste projeto para criar a tarefa.');return false}
      if(t.plannedTime&&!t.plannedDate){notice('Informe a data de execução para usar um horário.');return false}
      db.tasks.unshift(t);view.selectedId=t.id;persist();if(fromAgenda){const date=new Date(t.plannedDate+'T12:00:00');const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);view.weekOffset=Math.floor(Math.round((date-monday)/86400000)/7)}openPage(fromArea?'area':fromAgenda?'agenda':workflow.classified(db,t)?'esteira':'entrada');notice(workflow.classified(db,t)?'Demanda incluída na esteira.':'Demanda capturada. Falta classificar área e data.');return true;
    },ok:'Salvar demanda'});
  }
  function classifyTask(t,after){
    if(!t)return;
    promptModal({title:'Classificar demanda',subtitle:t.title,content:`<div class="classification-questions"><label class="field">1. Para onde vai?<select name="project" required>${projOption(t.project||'',false)}</select></label><label class="field">2. Qual o prazo final?<input type="date" name="dueDate" required value="${html(t.dueDate||'')}" /></label></div><p class="smalltext muted">A área identifica a demanda. A data determina sua urgência na esteira comum.</p>`,onSubmit:data=>{
      const project=String(data.get('project')||''),dueDate=String(data.get('dueDate')||'');
      if(!db.projects.some(area=>area.id===project)||!workflow.validDate(dueDate))return false;
      t.project=project;t.dueDate=dueDate;if(t.status==='inbox')t.status='todo';persist();
      if(after)after();else openPage('esteira');notice('Demanda classificada.');return true;
    },ok:'Incluir na esteira'});
  }
  function linkMail(){promptModal({title:'Vincular conversa do Gmail',subtitle:'Cole o link da conversa e associe a uma nova tarefa.',content:`<label class="field">Link da conversa<input name="url" type="url" required placeholder="https://mail.google.com/mail/u/0/#..." /></label><label class="field">Assunto<input name="subject" required maxlength="180" placeholder="Assunto do e-mail" /></label><label class="field">Remetente (opcional)<input name="sender" maxlength="150" placeholder="Setor responsável" /></label>`,onSubmit:data=>{const gmailUrl=validGmailUrl(String(data.get('url')));if(!gmailUrl){notice('Cole um endereço HTTPS válido de mail.google.com.');return false}const gmailSubject=String(data.get('subject')||'').trim();const gmailSender=String(data.get('sender')||'').trim();newTask({title:`Responder: ${gmailSubject}`,gmailUrl,gmailSubject,gmailSender});return false},ok:'Continuar'})}
  function exportData(){download(`flow-backup-${localDate()}.json`,JSON.stringify(db,null,2),'application/json');notice('Cópia de segurança exportada.')}
  function importData(){promptModal({title:'Importar backup',subtitle:'Atenção: esta operação substitui as tarefas e áreas do workspace atual.',content:`<label class="field">Arquivo JSON do Flow<input name="file" type="file" accept=".json,application/json" required /></label>`,onSubmit:()=>false,ok:'Importar'});const form=$('#active-modal-form');form.addEventListener('submit',async e=>{e.preventDefault();const file=form.elements.file.files?.[0];if(!file)return;try{const val=JSON.parse(await file.text());if(val?.version!==1||!Array.isArray(val.projects)||!Array.isArray(val.tasks))throw new Error();if(!confirm('Substituir todas as tarefas e áreas atuais pelo backup?'))return;db=workflow.normalize(val);workflow.reconcile(db);view.selectedId=db.tasks[0]?.id||null;persist();closeModal();render();notice('Backup importado com sucesso.')}catch{notice('Backup inválido ou incompatível.')}},{once:true})}
  function settingsModal(){promptModal({title:'Dados do Flow',subtitle:workspace.mode==='cloud'?'Dados privados da sua conta Google, salvos no Supabase.':'Seus dados estão salvos neste navegador.',content:`<div class="notice">Exporte uma cópia das suas tarefas e dos históricos de tempo. ${workspace.mode==='cloud'?'Confira o estado do salvamento no botão da conta.':'O acesso Google permite ativar o armazenamento na nuvem.'}</div><div class="row" style="margin-top:15px;flex-wrap:wrap"><button type="button" class="button" data-action="export-data">↓ Exportar backup</button><button type="button" class="button" data-action="import-data">↑ Importar backup</button>${workspace.mode==='cloud'?button('Trazer tarefas deste navegador','import-local'):button('Entrar com Google','account')}</div>`,onSubmit:()=>true,ok:'Fechar'})}

  async function generateAI(){
    const t=selectedTask();if(!t)return;
    const input=$('#edit-description');if(input)t.description=input.value;
    if(!t.description.trim()){notice('Escreva uma descrição antes de chamar o Gemini.');return}
    if(!accessToken){const value=prompt('Informe a senha de acesso ao assistente Flow (não é a chave Gemini). Ela será mantida apenas nesta aba.');if(value===null)return;accessToken=value.trim()}
    view.aiLoading=true;render();
    try{
      const result=await fetch('/api/gemini',{method:'POST',headers:{'content-type':'application/json','x-flow-access-token':accessToken},body:JSON.stringify({mode:view.aiMode,title:t.title,description:t.description})});
      const payload=await result.json().catch(()=>({}));
      if(!result.ok)throw new Error(payload.error||'Não foi possível consultar o Gemini.');
      if(!findTask(t.id))return;
      view.aiSuggestion={mode:view.aiMode,text:payload.text};notice('Sugestão recebida. Revise o conteúdo antes de aplicar.');
    }catch(err){if(String(err.message).includes('Senha'))accessToken='';notice(err.message||'Erro ao chamar o Gemini. Verifique a configuração no servidor.')}finally{view.aiLoading=false;persistAndRender()}
  }
  function applyAI(){const t=selectedTask();if(!t||!view.aiSuggestion)return;const text=$('#ai-output')?.value||view.aiSuggestion.text;if(view.aiSuggestion.mode==='subtasks'){const lines=text.split('\n').map(s=>s.replace(/^[-*•\d.)\s]+/,'').trim()).filter(Boolean).slice(0,6);lines.forEach(line=>t.subtasks.push({id:uuid(),text:line.slice(0,180),done:false}));notice(`${lines.length} subtarefas adicionadas.`)}else{t.description=text;notice('Sugestão aplicada à descrição.')}view.aiSuggestion=null;persistAndRender()}
  function handleCapture(){
    if(!location.hash.startsWith('#capture='))return;
    let payload={};try{payload=JSON.parse(decodeURIComponent(location.hash.slice(9)))}catch{history.replaceState(null,'',location.pathname+location.search);notice('Dados da extensão inválidos.');return}
    history.replaceState(null,'',location.pathname+location.search);
    const gmailUrl=validGmailUrl(payload.gmailUrl||'');if(!gmailUrl){notice('Captura recusada: link não pertence ao Gmail.');return}
    newTask({title:`Responder: ${String(payload.gmailSubject||'E-mail').slice(0,160)}`,gmailUrl,gmailSubject:String(payload.gmailSubject||'').slice(0,180),gmailSender:String(payload.gmailSender||'').slice(0,150)});
  }
  document.addEventListener('toggle',e=>{const details=e.target;if(details.matches?.('.demand-accordion')){if(details.open)expandedDemands.add(details.dataset.demand);else expandedDemands.delete(details.dataset.demand)}},true);
  document.addEventListener('click',async e=>{
    const element=e.target.closest('button');if(!element)return;
    const areaId=element.dataset.areaUp||element.dataset.areaDown;
    if(areaId){const index=db.projects.findIndex(p=>p.id===areaId),target=index+(element.dataset.areaUp?-1:1);if(index>=0&&target>=0&&target<db.projects.length){[db.projects[index],db.projects[target]]=[db.projects[target],db.projects[index]];persistAndRender();document.querySelector(`[data-area-${element.dataset.areaUp?'up':'down'}="${CSS.escape(areaId)}"]`)?.focus()}return}
    if(element.dataset.ignoreEmail){const email=FlowGmailReview.info().emails.find(e=>e.id===element.dataset.ignoreEmail);if(email){db.gmailReviews??={};db.gmailReviews[email.id]={...(db.gmailReviews[email.id]||{}),messageId:email.messageId,state:'ignored'};persistAndRender()}return}
    if(element.dataset.replyEmail){await composeReply(element.dataset.replyEmail);return}
    const page=element.dataset.page;
    if(page){openPage(page);return}
    if(element.dataset.timePeriod){view.timePeriod=element.dataset.timePeriod;view.timeOffset=0;render();return}
    if(element.dataset.openEmail){openGmail(findTask(element.dataset.openEmail));return}
    const id=element.dataset.task;if(id){selectTask(id);return}
    const p=element.dataset.project;if(p){view.areaId=p;openPage('area');return}
    const mailId=element.dataset.mailTask;if(mailId){view.mailSelected=mailId;render();return}
    const subid=element.dataset.deleteSub;if(subid){const t=selectedTask();t.subtasks=t.subtasks.filter(s=>s.id!==subid);persistAndRender();return}
    if(element.dataset.alert!==undefined){const i=Number(element.dataset.alert);db.preferences.alerts[i]=!db.preferences.alerts[i];persistAndRender();return}
    const t=selectedTask();try{switch(element.dataset.action){
      case 'toggle-done':view.hideDone=!view.hideDone;render();break;
      case 'show-areas':openPage('projetos');break;
      case 'new-initiative':newInitiative();break;
      case 'area-new-task':newTask({project:view.areaId});break;
      case 'initiative-new-task':{const initiative=(db.initiatives||[]).find(p=>p.id===element.dataset.id&&p.areaId===view.areaId);if(initiative)newTask({project:view.areaId,initiativeId:initiative.id});break}
      case 'new-task':newTask();break;
      case 'gmail-read-connect':try{await cloud.signIn('gmail')}catch(error){notice(error.message)}break;
      case 'gmail-refresh':await FlowGmailReview.refresh();await FlowGmailReview.analyze(db,persist);break;
      case 'gmail-more':await FlowGmailReview.refresh(true);await FlowGmailReview.analyze(db,persist);break;
      case 'gmail-analyze':await FlowGmailReview.analyze(db,persist);break;
      case 'gmail-read-disconnect':cloud.disconnectGmail();FlowGmailReview.reset();render();break;
      case 'gmail-mobile':
        try{const token=await cloud.createGmailToken();promptModal({title:'Gmail no celular',subtitle:'Cole esta chave no complemento Incluir no Flow. Ela vale por 90 dias e substitui a conexão anterior.',content:`<label class="field">Chave de conexão<input readonly value="${html(token)}" autocomplete="off" spellcheck="false" aria-label="Chave de conexão Gmail" /></label><p class="smalltext">Guarde esta chave apenas no complemento. Ela permite consultar áreas e incluir demandas na sua conta.</p>`,onSubmit:()=>true,ok:'Fechar'})}catch(error){notice(error.message)}break;
      case 'gmail-mobile-revoke':try{await cloud.revokeGmailToken();notice('Conexão do Gmail no celular revogada.')}catch(error){notice(error.message)}break;
      case 'new-project':newProject();break;
      case 'close-modal':closeModal();break;
      case 'open-active':openPage('foco');break;
      case 'show-pipeline':openPage('esteira');break;
      case 'show-inbox':openPage('entrada');break;
      case 'classify-task':classifyTask(findTask(element.dataset.id)||t);break;
      case 'return-task':{const task=findTask(element.dataset.id);if(!task)break;const previous={doing:'todo',waiting:'doing',done:'waiting'}[workflow.stage(db,task)];if(previous){workflow.cancel(db,task.id);task.status=previous;task.completedAt=null;persistAndRender();notice('Demanda retornou uma etapa.')}break}
      case 'advance-task':{const task=findTask(element.dataset.id);if(!task)break;const stage=workflow.stage(db,task);if(stage==='inbox'){classifyTask(task);break}if(stage==='waiting'){complete(task);break}if(stage==='todo'||stage==='doing'){task.status=stage==='todo'?'doing':'waiting';if(task.status!=='doing')workflow.cancel(db,task.id);persistAndRender()}break}
      case 'focus-task':start(findTask(element.dataset.id));break;
      case 'focus-start':start(focusTask());break;
      case 'focus-pause':workflow.pause(db);persistAndRender();break;
      case 'break-resume':workflow.resumeBreak(db);persistAndRender();break;
      case 'focus-change':if(db.focus)workflow.cancel(db,db.focus.taskId);view.focusId=null;persistAndRender();break;
      case 'focus-complete':complete(focusTask());break;
      case 'start':start(t);break;
      case 'pause':stop(t);persistAndRender();notice('Cronômetro pausado.');break;
      case 'complete':complete(t);break;
      case 'delete-task':if(confirm('Excluir a tarefa e todo seu histórico de tempo?')){workflow.cancel(db,t.id);db.tasks=db.tasks.filter(x=>x.id!==t.id);view.selectedId=null;persist();openPage(view.detailReturnPage||'esteira');notice('Tarefa excluída.')}break;
      case 'reply-task':if(t?.gmailThreadId)await composeReply(t.gmailThreadId);break;
      case 'open-email':openGmail(t);break;
      case 'open-linked-email':openGmail(findTask(view.mailSelected));break;
      case 'open-mail-task':selectTask(view.mailSelected);break;
      case 'export-ics':exportIcs(t);break;
      case 'calendar-connect':await globalThis.FlowCalendar.connect();break;
      case 'calendar-sync':await globalThis.FlowCalendar.synchronize();break;
      case 'calendar-disconnect':globalThis.FlowCalendar.disconnect();render();notice('Conexão encerrada. Os eventos já criados permanecem no Google Agenda.');break;
      case 'account':accountModal();break;
      case 'sign-out':await cloud.signOut();break;
      case 'cloud-retry':await cloud.flush(db);closeModal();notice('Dados salvos na nuvem.');break;
      case 'cloud-reload':if(confirm('Carregar os dados da nuvem? A cópia atual será preservada como backup neste navegador.'))await cloud.loadRemote();break;
      case 'import-local':importLocal();break;
      case 'time-previous':view.timeOffset--;render();break;
      case 'time-next':view.timeOffset++;render();break;
      case 'time-current':view.timeOffset=0;render();break;
      case 'time-report':reportModal();break;
      case 'time-csv':download(`flow-tempo-${view.timePeriod}-${localDate(timeReport().start)}.csv`,globalThis.FlowTime.csv(timeReport()),'text/csv;charset=utf-8');notice('Relatório CSV gerado.');break;
      case 'time-pdf':notice('Preparando o PDF…');await globalThis.FlowPDF.download(timeReport(),view.timePeriod);closeModal();notice('PDF gerado.');break;
      case 'week-previous':view.weekOffset--;render();break;
      case 'week-next':view.weekOffset++;render();break;
      case 'week-reset':view.weekOffset=0;render();break;
      case 'link-email':linkMail();break;
      case 'gemini':await generateAI();break;
      case 'apply-ai':applyAI();break;
      case 'discard-ai':view.aiSuggestion=null;render();break;
      case 'copy-ai':{const value=$('#ai-output')?.value||'';try{await navigator.clipboard.writeText(value);notice('Texto copiado.')}catch{notice('Não foi possível copiar; selecione o texto manualmente.')}break}
      case 'settings':settingsModal();break;
      case 'export-data':exportData();break;
      case 'import-data':importData();break;
    }}catch(error){notice(error.message||'Não foi possível concluir a ação.')}
  });
  document.addEventListener('submit',e=>{
    if(e.target.id==='sub-form'){e.preventDefault();const txt=e.target.elements.title.value.trim();if(!txt)return;selectedTask().subtasks.push({id:uuid(),text:txt.slice(0,180),done:false});persistAndRender()}
    if(e.target.id==='active-modal-form'){e.preventDefault();const submit=$('#modal-backdrop')._submit;if(!submit)return;const result=submit(new FormData(e.target));if(result!==false)closeModal()}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.dataset.emailReview)return;event.preventDefault();
    const email=FlowGmailReview.info().emails.find(e=>e.id===form.dataset.emailReview);if(!email)return;
    const data=new FormData(form),project=String(data.get('project')||''),dueDate=String(data.get('dueDate')||''),title=String(data.get('title')||'').trim();
    if(!title||!db.projects.some(p=>p.id===project)||!workflow.validDate(dueDate)){notice('Confira o título, a área e o prazo.');return}
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;const shouldArchive=data.has('archive');
    const existing=linkedEmailTask(email),cached=db.gmailReviews?.[email.id],review=cached?.messageId===email.messageId?cached:null;
    if(existing){existing.title=title;existing.gmailSubject=email.subject;existing.gmailSender=email.sender;existing.project=project;existing.dueDate=dueDate;existing.gmailMessageId=email.messageId;existing.gmailThreadId=email.id;}
    else db.tasks.unshift({id:uuid(),title,project,dueDate,status:'todo',priority:'medium',plannedDate:'',plannedTime:'',description:review?.summary||email.snippet,subtasks:[],sessions:[],startedAt:null,focusCycles:0,completedAt:null,createdAt:Date.now(),gmailUrl:email.gmailUrl,gmailSubject:email.subject,gmailSender:email.sender,gmailCaptureId:'gmail-review-'+email.id,gmailThreadId:email.id,gmailMessageId:email.messageId});
    db.gmailReviews??={};db.gmailReviews[email.id]={...(review||{}),messageId:email.messageId,state:'accepted'};persistAndRender();let confirmed=false;try{await cloud.flush(db);confirmed=true;if(shouldArchive)await FlowGmailReview.archive(email.id);notice(shouldArchive?'Demanda salva e e-mail arquivado.':existing?'Demanda atualizada.':'Demanda incluída na esteira.')}catch(error){if(!confirmed){db.gmailReviews[email.id].state='pending';persistAndRender();notice('A nuvem não confirmou o salvamento. O e-mail não foi arquivado: '+error.message)}else notice('Demanda salva, mas o Gmail não foi arquivado: '+error.message)}
  });
  document.addEventListener('change',e=>{
    const x=e.target,t=selectedTask();
    if(x.dataset.senderColor){db.gmailSenderColors??={};db.gmailSenderColors[x.dataset.senderColor]=x.value;persistAndRender();return}
    if(x.dataset.moveTask){const task=findTask(x.dataset.moveTask);if(!task||!['todo','doing','waiting','done'].includes(x.value))return;if(x.value==='done'){complete(task);return}if(x.value!=='doing')workflow.cancel(db,task.id);task.status=x.value;task.completedAt=null;persistAndRender();return}
    if(x.dataset.focusSub){const sub=focusTask()?.subtasks.find(s=>s.id===x.dataset.focusSub);if(sub){sub.done=x.checked;persistAndRender()}return}
    if(x.dataset.sub){const sub=t.subtasks.find(s=>s.id===x.dataset.sub);if(sub){sub.done=x.checked;persistAndRender()}return}
    if(x.id==='filter-project'){view.projectFilter=x.value;render();return}
    if(x.id==='filter-status'){view.statusFilter=x.value;render();return}
    if(x.id==='board-filter'){view.projectBoard=x.value;render();return}
    if(x.id==='focus-task-select'){view.focusId=x.value;render();return}
    if(x.id==='focus-minutes'||x.id==='break-minutes'){const n=Number(x.value),max=x.id==='focus-minutes'?180:60;if(!Number.isInteger(n)||n<1||n>max){notice(`Escolha entre 1 e ${max} minutos.`);render();return}db.preferences[x.id==='focus-minutes'?'focusMinutes':'breakMinutes']=n;persistAndRender();return}
    if(x.id==='ai-mode'){view.aiMode=x.value;view.aiSuggestion=null;render();return}
    if(x.id==='reminder-days'){db.preferences.reminderDays=Number(x.value);persist();return}
    const fieldMap={'edit-title':'title','edit-project':'project','edit-status':'status','edit-planned':'plannedDate','edit-time':'plannedTime','edit-due':'dueDate','edit-description':'description'};
    if(fieldMap[x.id] && t){const field=fieldMap[x.id];if(field==='status'&&x.value==='done'){workflow.cancel(db,t.id);t.completedAt=Date.now()}if(field==='status'&&t.status==='done'&&x.value!=='done')t.completedAt=null;t[field]=x.value;if((field==='project'||field==='dueDate')&&!workflow.classified(db,t))workflow.cancel(db,t.id);if(field==='status'&&x.value!=='doing')workflow.cancel(db,t.id);persistAndRender()}
  });
  document.addEventListener('input',e=>{if(e.target.id==='edit-description'){const t=selectedTask();if(t){t.description=e.target.value;persist()}}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY){db=workflow.normalize(load());if(workflow.reconcile(db))persist();render()}});
  window.addEventListener('flow:open-capture',event=>{db=workflow.normalize(load());const task=db.tasks.find(t=>t.gmailCaptureId===event.detail?.requestId);if(task){view.projectBoard='all';openPage('esteira');selectTask(task.id)}});
  function rememberEmailDraft(event){const x=event.target,form=x.closest?.('form[data-email-review]');if(!form||!x.name)return;const email=FlowGmailReview.info().emails.find(e=>e.id===form.dataset.emailReview);if(!email)return;view.emailDrafts??={};let draft=view.emailDrafts[email.id];if(draft?.messageId!==email.messageId)draft=view.emailDrafts[email.id]={messageId:email.messageId,fields:{}};draft.fields[x.name]=x.type==='checkbox'?x.checked:x.value;}
  document.addEventListener('input',rememberEmailDraft);document.addEventListener('change',rememberEmailDraft);
  function restoreEmailDrafts(){for(const email of FlowGmailReview.info().emails){const draft=view.emailDrafts?.[email.id];if(draft?.messageId!==email.messageId)continue;const form=document.querySelector(`form[data-email-review="${CSS.escape(email.id)}"]`);if(form)for(const [name,value] of Object.entries(draft.fields)){const input=form.elements.namedItem(name);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value}}}}
  window.addEventListener('flow:gmail-review',()=>{if(view.page==='entrada')render()});
  setInterval(()=>{if(view.page==='entrada'&&!document.hidden&&cloud.gmailToken()&&!FlowGmailReview.info().loading)FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(db,persist))},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&view.page==='entrada'&&cloud.gmailToken())FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(db,persist))});
  window.addEventListener('flow:sync-status',updateAccount);
  window.addEventListener('flow:calendar-status',()=>{if(view.page==='agenda')render()});
  window.addEventListener('flow:cloud-save',async event=>{
    if(event.detail?.key!==STORAGE_KEY||workspace.mode!=='cloud')return;
    const requestId=event.detail.requestId;
    try{db=workflow.normalize(load());if(!db.tasks.some(t=>t.gmailCaptureId===requestId))throw new Error('A demanda não foi recebida pelo Flow. Recarregue o app e tente novamente.');render();await cloud.flush(db);window.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId,ok:true}}))}
    catch(error){window.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId,ok:false,error:error.message}}))}
  });
  window.addEventListener('online',()=>{cloud.flush().catch(()=>{});globalThis.FlowCalendar.schedule()});
  $('.brand').addEventListener('click',e=>{e.preventDefault();openPage('esteira')});
  // Atualiza os rótulos; a contagem decorre dos timestamps, não da frequência do setInterval.
  setInterval(tick,1000);
  // Botão de backup facilmente acessível sem ocupar uma sexta tela.
  const nav=document.querySelector('.sidebar-foot');const backup=document.createElement('button');backup.className='button small workspace-settings';backup.type='button';backup.dataset.action='settings';backup.title='Exportar ou importar os dados';backup.textContent='⚙';nav.appendChild(backup);
  globalThis.FlowCalendar.initialize(()=>db,persist);
  persist();render();updateAccount();handleCapture();
  $('#login-screen').hidden=true;$('.app-shell').hidden=false;
  if(view.page==='entrada'&&cloud.gmailToken())FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(db,persist));
  setInterval(()=>{if(view.page==='tempo'&&!document.hidden&&!db.focus?.endsAt)return;if(view.page==='tempo'&&!document.hidden)render()},60000);
})();
