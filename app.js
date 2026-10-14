/* Interface UlbraFlow. Autenticação, sincronização e regras ficam em módulos separados. */
(async () => {
  'use strict';
  const cloud = globalThis.FlowCloud;
  let pendingShare=null;try{pendingShare=await globalThis.FlowShareTarget?.initialize();}catch{}
  const loginMessage = document.querySelector('#login-message');
  const finishStartup=()=>{document.querySelector('.app-shell').removeAttribute('aria-busy');document.querySelector('#screen').removeAttribute('aria-busy');};
  document.querySelector('#google-login').addEventListener('click', async () => {
    try { await cloud.signIn(); } catch (error) { loginMessage.textContent = error.message; }
  });
  document.querySelector('#login-retry').addEventListener('click', () => location.reload());
  let workspace;
  try { workspace = await cloud.initialize(); }
  catch (error) {
    finishStartup();
    loginMessage.setAttribute('role','alert');
    loginMessage.textContent = error.message;
    document.querySelector('#google-login').hidden = false;
    document.querySelector('#login-retry').hidden = false;
    return;
  }
  if (workspace.mode === 'login') {
    finishStartup();
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
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  // Backup importado precisa ter a estrutura do UlbraFlow; o restante é completado pela normalização.
  const validBackup=value=>{const list=(items,optional=false)=>optional&&items==null||Array.isArray(items)&&items.every(record);return record(value)&&value.version===1&&list(value.projects)&&list(value.tasks)&&list(value.archivedProjects,true)&&list(value.initiatives,true)&&list(value.projectTrash,true)&&(value.preferences==null||record(value.preferences))};
  // Única entrada de dados: abertura, importação, outra aba, captura da extensão e mescla da nuvem.
  function normalizeWorkspace(data){
    data=workflow.normalize(data);
    if(!record(data)||!Array.isArray(data.projects)||!Array.isArray(data.tasks))throw new Error('Dados do UlbraFlow inválidos ou incompatíveis.');
    data.initiatives=Array.isArray(data.initiatives)?data.initiatives.filter(record):[];
    for(const project of data.initiatives)for(const key of ['milestones','risks','indicators','notes','history'])if(project[key]!=null)project[key]=Array.isArray(project[key])?project[key].filter(record):[];
    data.projectTrash=(Array.isArray(data.projectTrash)?data.projectTrash:[]).filter(entry=>entry?.project?.id&&Number.isFinite(entry.expiresAt)&&entry.expiresAt>Date.now());
    const preferences=record(data.preferences)?data.preferences:(data.preferences={}),alerts=Array.isArray(preferences.alerts)?preferences.alerts:[];
    preferences.alerts=[true,true,true,false].map((fallback,i)=>typeof alerts[i]==='boolean'?alerts[i]:fallback);
    preferences.reminderDays=[1,2,3,7].includes(Number(preferences.reminderDays))?Number(preferences.reminderDays):1;
    for(const task of data.tasks){const cycles=Math.floor(Number(task.focusCycles));task.focusCycles=Number.isFinite(cycles)&&cycles>0?cycles:0}
    if(!record(data.gmailReviews))data.gmailReviews={};
    if(data.gmailSenderColors!=null&&!record(data.gmailSenderColors))data.gmailSenderColors={};
    globalThis.FlowGmailReview?.prune?.(data);
    return data;
  }
  // null: nada salvo. JSON ilegível lança erro para não ser trocado pelo exemplo.
  function readStored(){const raw=localStorage.getItem(STORAGE_KEY);return raw==null?null:JSON.parse(raw)}
  let db,startupError=null;
  try{const stored=workspace.mode==='cloud'?workspace.data:readStored();db=normalizeWorkspace(stored??(workspace.mode==='cloud'?{version:1,projects:globalThis.FlowAreas.defaults(),tasks:[],preferences:{}}:seed()))}
  catch(error){console.error(error);startupError=error;db=normalizeWorkspace({version:1,projects:globalThis.FlowAreas.defaults(),tasks:[],preferences:{}})}
  workflow.reconcile(db);
  const expandedDemands=new Set();
  let pipelineDrag=null,dragFrame=0,suppressDragClickUntil=0;
  let view={page:'entrada',focusId:null,selectedId:db.tasks[0]?.id||null,projectFilter:'all',statusFilter:'open',projectBoard:'all',boardDate:'today',boardSpecificDate:'',hideDone:false,mailSelected:null,weekOffset:0,timePeriod:'week',timeOffset:0,aiMode:'improve',aiSuggestion:null,aiLoading:false};
  let activeDictation=null;
  let accessToken='';
  let toastTimeout;
  // Gravar serializa o workspace inteiro. Digitação, análises e cronômetro usam persist() e viram uma gravação;
  // ações do usuário usam persistNow(). Saída da aba, foco perdido e 'flow:persist-flush' gravam na hora.
  let persistTimer=0,persistDirty=false,recovering=!!startupError,reloading=false;
  function writeLocal(serialized){
    try{localStorage.setItem(STORAGE_KEY,serialized);return true}
    catch(error){notice(error?.name==='QuotaExceededError'||error?.code===22?(workspace.mode==='cloud'?'O armazenamento deste navegador está cheio; as alterações continuam sendo enviadas para a nuvem. Exporte um backup e libere espaço no navegador.':'O armazenamento deste navegador está cheio e as últimas alterações não foram salvas. Exporte um backup e libere espaço no navegador.'):'Não foi possível salvar os dados neste navegador.');return false}
  }
  function flushPersist(){
    clearTimeout(persistTimer);persistTimer=0;if(!persistDirty)return true;persistDirty=false;
    if(recovering){queueMicrotask(()=>notice('Seus dados salvos não puderam ser abertos e foram preservados. Importe um backup em ⚙ Dados do UlbraFlow para voltar a salvar.'));return false}
    if(reloading)return false;
    let serialized;try{serialized=JSON.stringify(db)}catch{notice('Não foi possível salvar os dados.');return false}
    // A cópia local pode falhar por falta de espaço; a nuvem continua recebendo a alteração.
    const stored=writeLocal(serialized);
    try{cloud.queue(db,serialized)}catch{cloud.flush().catch(()=>{})}
    try{globalThis.FlowCalendar.schedule()}catch{}
    return stored;
  }
  const persist=()=>{persistDirty=true;clearTimeout(persistTimer);persistTimer=setTimeout(flushPersist,350)};
  const persistNow=()=>{persistDirty=true;return flushPersist()};
  const findTask=id=>db.tasks.find(t=>t.id===id);
  const selectedTask=()=>findTask(view.selectedId)||db.tasks[0];
  const findProject=id=>[...db.projects,...(db.archivedProjects||[])].find(p=>p.id===id);
  const projectName=id=>findProject(id)?.name||'Sem área';
  const persistAndRender=()=>{persistNow();render()};
  const badge=(s)=>`<span class="pill ${s==='done'?'green':s==='doing'?'blue':s==='waiting'?'gold':''}">${html(nameOfStatus[s]||s)}</span>`;
  const button=(label,action,primary=false,extra='')=>`<button type="button" class="button ${primary?'primary':''} ${action==='advance-task'?'lane-advance':''}" data-action="${action}" ${extra}>${label}</button>`;
  const pageHead=(title,subtitle,right='')=>`<div class="page-head"><div><div class="eyebrow">ULBRAFLOW / WORKSPACE</div><h1>${html(title)}</h1><p>${html(subtitle)}</p></div>${right}</div>`;
  const selectedFilterTasks=()=>db.tasks.filter(t=>(view.projectFilter==='all'||t.project===view.projectFilter)&&(view.statusFilter==='all'||(view.statusFilter==='open'?t.status!=='done':workflow.stage(db,t)===view.statusFilter)));
  const projOption=(current='all',all=true,legacy=false)=>`${all?'<option value="all">Todas as áreas</option>':`<option value="" ${!current?'selected':''}>Escolha uma área</option>`}${db.projects.map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''}>${html(p.name)}</option>`).join('')}${(all?(db.archivedProjects||[]):legacy?(db.archivedProjects||[]).filter(p=>p.id===current):[]).map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''} ${!all?'disabled':''}>${html(p.name)} (anterior)</option>`).join('')}`;
  const statusOption=(s,includeInbox=false)=>Object.entries(nameOfStatus).filter(([key])=>includeInbox||key!=='inbox').map(([key,name])=>`<option value="${key}" ${s===key?'selected':''}>${name}</option>`).join('');
  function notice(text){const box=$('#toast');box.textContent=text;box.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>box.classList.remove('visible'),3400)}
  function titleRow(title, right=''){return `<div class="between"><h3 class="sectiontitle">${title}</h3>${right}</div>`}

  const countdown=ms=>{const seconds=Math.ceil(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`};
  const urgencyBadge=t=>{const u=workflow.urgency(t);return `<span class="urgency ${u.tone}">${html(u.label)}${t.dueDate&&t.status!=='done'?` · ${dateLabel(t.dueDate)}`:''}</span>`};
  const areaBadge=t=>`<span class="area-label"><i style="background:${html(/^#[a-f0-9]{6}$/i.test(findProject(t.project)?.color||'')?findProject(t.project).color:'#8998ae')}"></i>${html(projectName(t.project))}</span>`;
  const hasGeminiReview=t=>!!(t.geminiAnalyzed||t.geminiClassified||(db.gmailReviews?.[t.gmailThreadId]?.state==='accepted'&&db.gmailReviews[t.gmailThreadId].messageId===t.gmailMessageId&&db.gmailReviews[t.gmailThreadId].summary));
  const nextTask=()=>db.tasks.filter(t=>workflow.classified(db,t)&&['todo','doing'].includes(t.status)).sort(workflow.byDue)[0];
  const focusTask=()=>findTask(db.focus?.taskId)||db.tasks.find(t=>t.id===view.focusId&&t.status!=='done'&&workflow.classified(db,t))||nextTask()||db.tasks.filter(t=>t.status!=='done'&&workflow.classified(db,t)).sort(workflow.byDue)[0];
  const workflowTrail=()=>'<div class="workflow-trail"><span><b>01</b> Classificar</span><i>→</i><span><b>02</b> Organizar na esteira</span><i>→</i><span><b>03</b> Entrar em foco</span></div>';

  function linkedEmailTask(email){return db.tasks.find(t=>t.gmailThreadId===email.id||t.gmailCaptureId==='gmail-mobile-'+email.id||t.gmailUrl?.endsWith('#all/'+email.id));}
  function renderGmailReview(){
    const state=FlowGmailReview.info(),connected=!!cloud.gmailToken();
    const rows=state.emails.filter(email=>{const r=db.gmailReviews?.[email.id],t=linkedEmailTask(email);return !(r?.messageId===email.messageId&&['accepted','ignored'].includes(r.state))&&!(t?.gmailMessageId===email.messageId&&r?.state!=='pending')});
    return `<section class="card gmail-review-box"><div class="between"><h3 class="sectiontitle">Para revisar</h3><div class="row">${connected?button(state.loading?'Buscando…':'Atualizar e-mails','gmail-refresh',false,state.loading?'disabled':'')+button(`<img src="./assets/gemini.svg" alt="" width="16" height="16"> ${state.analyzing?`Analisando · ${state.completed||0} prontas`:'Analisar com Gemini'}`,'gmail-analyze',false,state.analyzing||!state.emails.length?'disabled':'')+button('Desconectar leitura','gmail-read-disconnect'):button('Conectar leitura do Gmail','gmail-read-connect',true)}</div></div><p class="smalltext muted">A leitura consulta a caixa de entrada. Ao analisar, o texto das últimas três mensagens é enviado ao Gemini, sem anexos. Você confirma cada demanda antes de incluí-la na esteira.</p>${state.error?`<p class="sync-error" role="alert">${html(state.error)}</p>`:''}<div class="gmail-review-grid">${rows.map(email=>{const sender=FlowGmailReview.address(email.sender).toLowerCase(),color=/^#[a-f0-9]{6}$/i.test(db.gmailSenderColors?.[sender]||'')?db.gmailSenderColors[sender]:'',review=db.gmailReviews?.[email.id],current=review?.messageId===email.messageId?review:null,existing=linkedEmailTask(email);return `<article class="gmail-review-card" data-email-card="${html(email.id)}" ${color?`style="border-left:4px solid ${color};background:${color}14"`: ''}><h3>${html(email.subject)}</h3><p class="smalltext muted">${html(email.sender)} · ${new Date(email.date).toLocaleDateString('pt-BR')}</p>${existing?'<span class="pill">Nova resposta · demanda já vinculada</span>':''}<span class="gemini-status ${current?'classified':'pending'}"><img src="./assets/gemini.svg" alt="Gemini" width="16" height="16">${current?(current.areaId?'Classificado pelo Gemini':'Analisado pelo Gemini · revisar área'):'Aguardando classificação Gemini'}</span><p class="gmail-summary">${html(current?.summary||email.snippet||'Sem texto disponível.')}</p>${current?.alert?`<p class="review-alert">${html(current.alert)}</p>`:''}${current?.needsReview?'<p class="smalltext muted">Confira a classificação sugerida.</p>':''}<label class="sender-color-label">Cor deste remetente <input type="color" data-sender-color="${html(sender)}" value="${color||'#507ee9'}" /></label>${email.truncated?'<p class="smalltext muted">Análise limitada às últimas mensagens e a 12 mil caracteres.</p>':''}<form data-email-review="${html(email.id)}"><label class="field">Título da demanda<input name="title" maxlength="180" required value="${html(current?.title||email.subject.slice(0,180))}" /></label><div class="detail-grid"><label class="field">Área${!current?'<small>Escolha uma área ou analise com Gemini</small>':''}<select name="project" required>${projOption(current?.areaId||existing?.project||'',false)}</select></label><label class="field">Prazo final<input name="dueDate" type="date" required value="${html(workflow.validDate(current?.dueDate)?current.dueDate:existing?.dueDate||'')}" /></label></div>${current?.dateEvidence?`<p class="smalltext muted">Trecho do prazo: “${html(current.dateEvidence)}”</p>`:''}<label class="archive-choice"><input type="checkbox" name="archive" checked> Arquivar no Gmail após salvar</label><div class="row"><button type="button" class="button" data-reply-email="${html(email.id)}">Responder</button><button type="submit" class="button primary">${existing?'Atualizar demanda':'✓ Incluir na esteira'}</button><button type="button" class="button" data-ignore-email="${html(email.id)}">Ignorar</button><a class="button" target="_blank" rel="noopener noreferrer" href="${html(email.gmailUrl)}">Abrir Gmail</a></div></form></article>`}).join('')||`<p class="muted smalltext">${state.loading?'Carregando e-mails…':connected?'Clique em Atualizar e-mails para buscar mensagens, ou todas as mensagens carregadas já foram revisadas.':'Conecte sua conta para revisar os e-mails aqui.'}</p>`}${db.tasks.filter(t=>workflow.stage(db,t)==='inbox').map(t=>`<article class="gmail-review-card" data-entry-card="${html(t.id)}"><span class="pill">${t.gmailUrl?'E-mail vinculado':t.source==='share'?'Texto compartilhado':'Entrada manual'}</span><h3 style="margin-top:10px">${html(t.title)}</h3><p class="gmail-summary">${html(t.description||'')}</p><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}</div><div class="row" style="margin-top:12px">${button('Classificar →','classify-task',true,`data-id="${html(t.id)}"`)}${button('Detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div></article>`).join('')}</div>${state.nextPage?button('Carregar mais','gmail-more'):''}</section>`;
  }
  function renderInbox(){
    return pageHead('Entrada','Revise e-mails e registros manuais antes de incluí-los na esteira.',`<div class="row">${button('+ Adicionar entrada','new-task',true)}</div>`)+workflowTrail()+(pendingShare?`<section class="card pending-share"><h3>Texto compartilhado recebido</h3><p class="smalltext">${html(pendingShare.title||pendingShare.text.slice(0,160))}</p><div class="row">${button('Revisar entrada','review-share',true)}${button('Descartar','discard-share')}</div></section>`:'')+renderGmailReview();
  }

  function renderPipelineBody(t,status){return `<div class="demand-body">${hasGeminiReview(t)?'<span class="gemini-status classified"><img src="./assets/gemini.svg" alt="Gemini" width="16" height="16">Analisado com Gemini</span>':''}<div class="task-meta">${urgencyBadge(t)}</div>${active(t)?'<span class="focus-indicator">● Em foco agora</span>':''}${validGmailUrl(t.gmailUrl)?`<button type="button" class="button small pipeline-gmail" data-open-email="${html(t.id)}" aria-label="Abrir Gmail" title="Abrir e-mail no Gmail"><img src="./assets/gmail.svg" alt="" width="18" height="14"></button>`:''}<div class="pipeline-actions">${status==='inbox'?button('Classificar','classify-task',false,`data-id="${html(t.id)}"`):status!=='done'?button(active(t)?'Abrir foco':'Focar','focus-task',false,`data-id="${html(t.id)}"`):'<span class="completed-label">✓ Entregue</span>'}${button('Detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div><div class="stage-actions">${['doing','waiting','done'].includes(status)?button('← Retornar','return-task',false,`data-id="${html(t.id)}"`):''}${status!=='done'?button(status==='inbox'?'Classificar →':status==='waiting'?'Concluir →':'Avançar →','advance-task',false,`data-id="${html(t.id)}"`):''}</div>${status!=='inbox'?`<select class="lane-move" data-move-task="${html(t.id)}" aria-label="Mover ${html(t.title)} para outra etapa"><option value="">Mover etapa…</option>${Object.entries(nameOfStatus).filter(([key])=>key!=='inbox'&&key!==status).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select>`:''}</div>`;}
  function renderPipeline(){
    const open=db.tasks.filter(t=>t.status!=='done'), today=localDate();
    const inbox=open.filter(t=>workflow.stage(db,t)==='inbox').length;
    const late=open.filter(t=>workflow.classified(db,t)&&t.dueDate<today).length;
    const dueToday=open.filter(t=>workflow.classified(db,t)&&t.dueDate===today).length;
    const focus=findTask(db.focus?.taskId), next=focus||nextTask();
    const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    const visible=db.tasks.filter(t=>(view.projectBoard==='all'||t.project===view.projectBoard)&&(view.boardDate==='all'||view.boardDate==='today'&&t.dueDate===today||view.boardDate==='tomorrow'&&t.dueDate===localDate(tomorrow)||view.boardDate==='late'&&!!t.dueDate&&t.dueDate<today||view.boardDate==='specific'&&!!view.boardSpecificDate&&t.dueDate===view.boardSpecificDate)).sort(workflow.byDue);
    const byStage={inbox:[],todo:[],doing:[],waiting:[],done:[]};for(const task of visible)byStage[workflow.stage(db,task)].push(task);
    const lanes=[['inbox','A classificar','Definir área e data'],['todo','A fazer','Próximas demandas'],['doing','Em andamento','Trabalho iniciado'],['waiting','Aguardando','Depende de um retorno'],['done','Concluídas','Trabalho entregue']].filter(([status])=>!view.hideDone||status!=='done').map(([status,title,subtitle])=>{
      const tasks=byStage[status];
      return `<section class="pipeline-lane" data-stage="${status}"><div class="lanehead"><span>${title}</span><span class="lane-count">${tasks.length}</span></div><p class="lane-subtitle">${subtitle}</p>${tasks.map(t=>`<article class="pipeline-task ${active(t)?'in-focus':''}" data-pipeline-task="${html(t.id)}" draggable="true"><input type="checkbox" class="task-complete-check" data-complete-task="${html(t.id)}" aria-label="${status==='done'?'Concluída':'Concluir'}: ${html(t.title)}" title="${status==='done'?'Demanda concluída':'Marcar como concluída'}" ${status==='done'?'checked disabled':''}><button type="button" class="task-drag-handle" data-drag-task="${html(t.id)}" draggable="true" aria-label="Mover ${html(t.title)} para outra etapa" title="Arraste para outra etapa ou clique para escolher"><svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/></svg></button><details class="demand-accordion" data-demand="${html(t.id)}" ${expandedDemands.has(t.id)?'open':''}><summary><strong>${html(t.title)}</strong>${areaBadge(t)}</summary>${expandedDemands.has(t.id)?renderPipelineBody(t,status):''}</details></article>`).join('')||'<div class="lane-empty">Nenhuma demanda aqui.</div>'}</section>`;
    }).join('');
    const direction='<ol class="pipeline-direction" aria-label="Fluxo da esquerda para a direita">'+['Classificar','Preparar','Executar','Aguardar','Entregar'].filter((_,i)=>!view.hideDone||i<4).map((label,i)=>`<li><b>${String(i+1).padStart(2,'0')}</b><span>${label}</span>${i<4?'<i aria-hidden="true">→</i>':'<i aria-hidden="true">✓</i>'}</li>`).join('')+'</ol>';
    return pageHead('Uma esteira. Todas as demandas.','Da entrada à entrega, um fluxo da esquerda para a direita.')+`<div class="pipeline-summary"><button data-page="entrada"><span>A classificar</span><strong>${inbox}</strong></button><div><span>Para hoje</span><strong>${dueToday}</strong></div><div class="${late?'has-late':''}"><span>Atrasadas</span><strong>${late}</strong></div><button data-page="foco"><span>${focus?'Seu foco':'Próximo foco'}</span><strong class="summary-task">${html(next?.title||'Escolha uma demanda')}</strong><small>${focus?'Abrir sessão →':'Entrar em foco →'}</small></button></div><div class="pipeline-toolbar"><div><h3 class="sectiontitle">Esteira comum</h3><p>Avance a demanda pelas etapas. Datas mais próximas aparecem primeiro.</p></div><div class="pipeline-filter-actions">${button(view.hideDone?'Mostrar concluídas':'Ocultar concluídas','toggle-done',false,`aria-pressed="${view.hideDone}"`)}<label class="field">Prazo final<select id="board-date-filter" class="filterselect">${[['today','Hoje'],['all','Todas as datas'],['tomorrow','Amanhã'],['late','Atrasadas'],['specific','Escolher data']].map(([value,label])=>`<option value="${value}" ${view.boardDate===value?'selected':''}>${label}</option>`).join('')}</select></label>${view.boardDate==='specific'?`<label class="field">Data<input type="date" id="board-specific-date" value="${html(view.boardSpecificDate)}"></label>`:''}<label class="field">Área<select id="board-filter" class="filterselect">${projOption(view.projectBoard)}</select></label></div></div><div class="pipeline-board ${view.hideDone?'hide-done':''}">${direction}${lanes}</div><p class="board-footnote">Aguardando é usado quando há um retorno pendente. Você também pode concluir a tarefa diretamente em Detalhes ou Mover etapa.</p>`;
  }
  function renderFocus(){
    const t=focusTask(), f=db.focus, working=f?.phase==='work', paused=f&&!f.endsAt&&f.phase!=='ready';
    const candidates=db.tasks.filter(t=>workflow.classified(db,t)&&t.status!=='done').sort(workflow.byDue);
    const options=candidates.map(x=>`<option value="${html(x.id)}" ${x.id===t?.id?'selected':''}>${html(x.title)} · ${html(projectName(x.project))}</option>`).join('');
    const title=f?.phase==='break'?'Hora de respirar.':f?.phase==='ready'?'Pronto para continuar?':'Agora, só esta tarefa.';
    const controls=!t?button('Capturar demanda','new-task',true):working&&f.endsAt?button('Ⅱ Pausar foco','focus-pause',true):f?.phase==='break'?`${f.endsAt?button('Ⅱ Pausar descanso','focus-pause'):button('Retomar descanso','break-resume',true)}${button('Começar próximo ciclo','focus-start')}`:button(paused?'Retomar foco':'Começar ciclo','focus-start',true);
    return pageHead('Foco','Uma tarefa por vez. Tempo para trabalhar, tempo para descansar.')+`<div class="focus-layout"><section class="card focus-main ${f?.phase==='break'?'on-break':''}"><div class="eyebrow">${f?.phase==='break'?'PAUSA':f?.phase==='ready'?'CICLO CONCLUÍDO':paused?'FOCO PAUSADO':'SEU ESPAÇO DE CONCENTRAÇÃO'}</div><h2>${title}</h2>${t?`<div class="focus-task-title">${html(t.title)}</div><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}</div>`:'<p class="muted">Classifique uma demanda por área e data para começar.</p>'}<div class="focus-ring"><div><span class="focus-countdown" data-countdown>${countdown(workflow.remaining(db))}</span><small>${f?.phase==='break'?'descanso':f?.phase==='ready'?'comece quando estiver pronto':paused?'ciclo pausado':'minutos de foco'}</small></div></div><div class="focus-controls">${controls}</div>${t?`<div class="focus-secondary">${button('✓ Concluir tarefa','focus-complete')}${f?button('Trocar tarefa','focus-change'):button('Ver detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div><div class="focus-total"><span>Tempo trabalhado <b data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</b></span><span><b>${Number(t.focusCycles)||0}</b> ciclos completos</span></div>`:''}<p class="focus-caption">Ao terminar o foco, o descanso começa. O próximo ciclo de trabalho depende de você.</p></section><aside class="focus-aside"><section class="card"><h3 class="sectiontitle">Sua tarefa</h3><label class="field">Escolher demanda<select id="focus-task-select" ${f?'disabled':''}>${options||'<option>Nenhuma demanda classificada</option>'}</select></label>${t?.subtasks.length?`<div class="focus-subtasks">${t.subtasks.map(s=>`<label class="subtask ${s.done?'done':''}"><input type="checkbox" data-focus-sub="${html(s.id)}" ${s.done?'checked':''}><span>${html(s.text)}</span></label>`).join('')}</div>`:'<p class="muted smalltext">O detalhe da tarefa reúne anotações, e-mail e histórico.</p>'}${t?button('Abrir detalhes','task-detail',false,`data-task="${html(t.id)}"`):button('Classificar entrada','show-inbox')}</section><section class="card"><h3 class="sectiontitle">Seu ritmo</h3><div class="rhythm-fields"><label class="field">Foco (min)<input id="focus-minutes" type="number" min="1" max="180" step="1" value="${Number(db.preferences.focusMinutes)||25}" /></label><label class="field">Pausa (min)<input id="break-minutes" type="number" min="1" max="60" step="1" value="${Number(db.preferences.breakMinutes)||5}" /></label></div><p class="muted smalltext">Alterações valem para o próximo período. O tempo atual é preservado.</p></section><div class="focus-principle"><span>◉</span><p>As demandas são muitas.<br><b>A sua atenção é uma.</b></p></div></aside></div>`;
  }

  function renderTasks(){
    const filtered=selectedFilterTasks();
    const t=filtered.find(x=>x.id===view.selectedId)||filtered[0];
    if(!t)return pageHead('Detalhe da tarefa','Selecione uma demanda na esteira.',button('← Esteira','show-pipeline'));
    view.selectedId=t.id;
    const len=t.sessions.length, last=t.sessions.filter(s=>s.end).slice(-3).reverse();
    const history=last.length?last.map(s=>`<div class="time-record">${new Date(s.start).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${secondsLabel(Math.floor((s.end-s.start)/1000))}</div>`).join(''):'<p class="muted smalltext">Nenhuma sessão encerrada ainda.</p>';
    const origin=t.gmailUrl?`<div class="originbox"><b>✉ E-mail vinculado</b><div>${html(t.gmailSubject||'Conversa original')}</div><div style="margin-top:6px">${html(t.gmailSender)}</div><button class="button small" data-action="open-email" type="button"><img src="./assets/gmail.svg" alt="" width="18" height="14"> Abrir conversa original</button></div>`:'';
    const result=view.aiSuggestion?`<div class="ai-suggestion"><h4>✧ Sugestão recebida do Gemini</h4><textarea id="ai-output" aria-label="Texto gerado para revisão">${html(view.aiSuggestion.text)}</textarea><div class="row" style="flex-wrap:wrap">${button(view.aiSuggestion.mode==='subtasks'?'Criar subtarefas':'Aplicar à descrição','apply-ai',true)}${button('Copiar texto','copy-ai')}${button('Descartar','discard-ai')}</div></div>`:'';
    const detail=`<section class="demand-detail"><div class="between"><span class="pill blue">${html(projectName(t.project))}</span>${badge(workflow.stage(db,t))}</div><h2 class="detail-title">${html(t.title)}</h2>${hasGeminiReview(t)?'<span class="gemini-status classified"><img src="./assets/gemini.svg" alt="Gemini" width="16" height="16">Analisado com Gemini</span>':''}${!workflow.classified(db,t)&&t.status!=='done'?`<div class="classification-hint">Defina a área e a data para colocar esta demanda na esteira. ${button('Classificar','classify-task',true,`data-id="${html(t.id)}"`)}</div>`:''}
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
      <div class="timerbox"><div class="label">◷ TEMPO DE TRABALHO</div><div class="timer-value" data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</div><div class="timer-meta">${active(t)?'● Ciclo de foco em andamento':'Tempo registrado de trabalho'} · ${len} ${len===1?'sessão':'sessões'} no histórico</div><div class="actionbar">${active(t)?button('Ⅱ Pausar','pause',true):button('Entrar em foco','start',true)}${t.status==='done'?button('← Reabrir tarefa','return-task',false,`data-id="${html(t.id)}"`):button('✓ Concluir','complete')}${t.gmailUrl?button('<img src="./assets/gmail.svg" alt="" width="18" height="14"> Voltar ao Gmail','open-email'):''}${t.gmailThreadId?button('Responder e-mail','reply-task'):''}</div></div>
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
  const projectModels={
    simple:{name:'Projeto simples',fields:['Objetivo','Entregas','Responsáveis','Cronograma','Critérios de sucesso']},
    pdca:{name:'PDCA',fields:['Planejar: problema, objetivo e plano','Executar: ações e responsáveis','Verificar: indicadores e resultados','Agir: ajustes e padronização']},
    fivew:{name:'5W2H',fields:['O quê será feito?','Por quê?','Onde?','Quando?','Quem?','Como?','Quanto custa?']},
    action:{name:'Plano de ação',fields:['Objetivo','Ações','Responsáveis','Prazos','Recursos','Acompanhamento']},
    process:{name:'Melhoria de processo',fields:['Problema','Processo atual','Causas','Melhorias propostas','Indicadores','Plano de implantação']},
    academic:{name:'Projeto acadêmico',fields:['Justificativa','Objetivo geral','Objetivos específicos','Metodologia','Cronograma','Resultados esperados']},
    scrum:{name:'Scrum',fields:['Objetivo do produto','Equipe e papéis','Backlog','Sprints','Critérios de conclusão','Revisão e retrospectiva']},
    okr:{name:'OKR',fields:['Objetivo','Resultados-chave mensuráveis','Iniciativas','Responsáveis','Período','Acompanhamento']},
    lean:{name:'A3 / Lean',fields:['Contexto','Situação atual','Meta','Análise de causas','Contramedidas','Plano de ação','Verificação dos resultados']},
    design:{name:'Design Thinking',fields:['Problema e público','Empatia: necessidades','Definição do desafio','Ideias','Protótipo','Testes e aprendizados']}
  };
  $('#project-template-menu').innerHTML='<button type="button" data-page="project-assessment"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Avaliação Gemini</button>'+Object.entries(projectModels).map(([key,model])=>`<button type="button" data-project-model="${key}">${model.name}</button>`).join('')+'<button type="button" data-action="create-model-project">+ Criar projeto</button>';
  function renderProjectTrash(){const entries=(db.projectTrash||[]).filter(entry=>entry.expiresAt>Date.now());return `<details class="card project-trash"><summary>Lixeira de projetos · ${entries.length}</summary><p class="smalltext muted">Projetos excluídos podem ser restaurados por 30 dias. As tarefas permanecem nas áreas.</p>${entries.map(entry=>`<div class="between project-trash-row"><div><strong>${html(entry.project.name)}</strong><p class="smalltext muted">Disponível até ${html(new Date(entry.expiresAt).toLocaleDateString('pt-BR'))}</p></div>${button('Restaurar projeto','restore-initiative',false,`data-id="${html(entry.project.id)}"`)}</div>`).join('')||'<p class="smalltext muted">Nenhum projeto na lixeira.</p>'}</details>`;}
  function requestProjectDeletion(project){
    promptModal({title:'Excluir projeto',subtitle:`Quer excluir o projeto “${project.name}”?`,content:`<p>O projeto ficará na lixeira por <strong>30 dias</strong>. As tarefas e seus tempos registrados serão mantidos na área.</p><label class="field">Digite o nome do projeto para confirmar<input name="confirmName" required autocomplete="off" placeholder="${html(project.name)}"></label><p id="delete-project-status" role="status" class="smalltext"></p>`,ok:'Excluir projeto',onSubmit:data=>{
      const current=db.initiatives.find(p=>p.id===project.id);if(!current){closeModal();return false;}
      if(String(data.get('confirmName')||'').trim()!==current.name.trim()){$('#delete-project-status').textContent='Digite exatamente o nome do projeto para confirmar.';return false;}
      const now=Date.now(),tasks=db.tasks.filter(t=>t.initiativeId===current.id);db.projectTrash??=[];db.projectTrash.push({project:structuredClone(current),deletedAt:now,expiresAt:now+30*86400000,taskIds:tasks.map(t=>t.id)});
      tasks.forEach(t=>{t.initiativeId=null;});db.initiatives=db.initiatives.filter(p=>p.id!==current.id);if(projectDraft?.id===current.id)projectDraft=null;persistAndRender();notice('Projeto na lixeira por 30 dias. Tarefas preservadas.');return true;
    }});
  }
  function restoreProject(entry,areaId=entry.project.areaId){
    if(entry.expiresAt<=Date.now()){notice('O prazo de restauração deste projeto terminou.');return;}
    if(db.initiatives.some(p=>p.id===entry.project.id)||!findProject(areaId))return;
    const project={...structuredClone(entry.project),areaId};db.initiatives.push(project);
    db.tasks.filter(t=>(entry.taskIds||[]).includes(t.id)&&!t.initiativeId&&t.project===areaId).forEach(t=>{t.initiativeId=project.id;});
    db.projectTrash=db.projectTrash.filter(item=>item!==entry);persistAndRender();notice('Projeto restaurado.');
  }
  function renderMyProjects(){
    const projects=db.initiatives||[];
    return pageHead('Meus projetos','Projetos de todas as áreas, com modelos para organizar a execução.',button('+ Criar projeto','create-model-project',true))+`<div class="area-projects">${projects.map(p=>{const area=findProject(p.areaId),model=projectModels[p.model]||projectModels.simple;return `<section class="card"><div class="between"><div><h3 class="sectiontitle">${html(p.name)}</h3><p class="smalltext muted">${html(area?.name||'Área indisponível')} · ${html(model.name)}</p></div><div class="row">${button('Abrir projeto','edit-model-project',false,`data-id="${html(p.id)}"`)}${button('Excluir projeto','delete-initiative',false,`data-id="${html(p.id)}"`)}${area?button('+ Nova tarefa','project-library-task',false,`data-id="${html(p.id)}"`):''}</div></div>${p.description?`<p class="project-description">${html(p.description)}</p>`:''}<div class="project-list-progress">${(()=>{const tasks=db.tasks.filter(t=>t.initiativeId===p.id),done=tasks.filter(t=>t.status==='done').length;return `<div class="between"><span class="smalltext">${done}/${tasks.length} tarefas concluídas</span><span class="smalltext">${html(({planning:'Planejamento',active:'Em execução',waiting:'Aguardando',done:'Concluído'})[p.phase]||'Planejamento')}</span></div><div class="progressbar"><i style="width:${tasks.length?Math.round(done/tasks.length*100):0}%;background:var(--accent)"></i></div>${p.owner||p.endDate?`<p class="smalltext muted">${html(p.owner||'Responsável a definir')}${p.endDate?' · Prazo: '+html(dateLabel(p.endDate)):''}</p>`:''}`;})()}</div></section>`;}).join('')||'<section class="card"><p>Você ainda não criou projetos. Escolha um modelo no menu para começar.</p></section>'}</div>`+renderProjectTrash();
  }
  const projectGuides={
    simple:['Organize um projeto com objetivo claro, entregas e acompanhamento.',['Defina o resultado que quer alcançar e o problema que será resolvido.','Liste produtos ou serviços que deverão ser entregues.','Indique quem executa, decide e acompanha cada entrega.','Distribua as entregas no tempo, com marcos e dependências.','Defina evidências objetivas para saber se o projeto foi bem-sucedido.']],
    pdca:['Melhore um processo em ciclos: planeje, execute, confira os resultados e ajuste o trabalho.',['Descreva o problema, sua causa, a meta e as ações propostas. Use dados da situação atual como referência.','Registre como o plano será executado: atividades, responsáveis, recursos e prazos.','Compare o resultado com a meta. Informe indicadores, evidências e diferenças observadas.','Defina correções para o próximo ciclo e padronize o que funcionou.']],
    fivew:['Transforme uma ideia em um plano de execução respondendo a sete perguntas essenciais.',['Descreva a ação e o resultado concreto esperado.','Explique a necessidade, o benefício e a justificativa da ação.','Indique o setor, local ou sistema em que a ação acontecerá.','Defina início, prazo final e marcos intermediários.','Identifique responsáveis pela execução e aprovação.','Descreva o procedimento, recursos e etapas de execução.','Estime custos e indique a origem dos recursos. Se desconhecidos, registre o que falta levantar.']],
    action:['Converta um objetivo em ações acompanháveis, com responsáveis e prazos.',['Defina o resultado esperado.','Liste ações específicas e a ordem de execução.','Associe cada ação a uma pessoa ou equipe.','Defina datas e dependências entre as ações.','Identifique orçamento, materiais e apoio necessários.','Explique como o avanço será acompanhado e quando haverá revisão.']],
    process:['Analise um processo e planeje melhorias com base em evidências.',['Descreva o problema e seu impacto.','Explique como o trabalho acontece hoje, incluindo entradas, saídas e gargalos.','Investigue as causas com dados e observações. Separe hipóteses de fatos.','Proponha mudanças e explique como elas tratam as causas.','Defina medidas, referências atuais e metas.','Planeje teste, implantação, responsáveis e acompanhamento.']],
    academic:['Estruture uma iniciativa acadêmica com justificativa, objetivos e método.',['Explique a relevância e a necessidade do projeto.','Defina o resultado principal que pretende alcançar.','Desdobre o objetivo geral em resultados específicos.','Descreva procedimentos, participantes, instrumentos e forma de análise.','Organize as atividades e datas de cada fase.','Indique as entregas, contribuições e evidências esperadas.']],
    scrum:['Organize o desenvolvimento em ciclos curtos, com prioridades, entregas e aprendizado.',['Defina o valor do produto para seu público.','Indique papéis, responsabilidades e como a equipe se organiza.','Liste necessidades em ordem de prioridade, com critérios de aceitação.','Defina o objetivo de cada sprint, duração e itens selecionados.','Estabeleça condições de qualidade para considerar uma entrega pronta.','Planeje a demonstração dos resultados e a reflexão sobre melhorias da equipe.']],
    okr:['Conecte um objetivo relevante a resultados mensuráveis e às iniciativas que os sustentam.',['Descreva a mudança que quer alcançar, com clareza e foco.','Defina resultados mensuráveis, com referência atual e meta.','Liste ações que podem contribuir para os resultados-chave.','Indique quem acompanha cada resultado e conduz as iniciativas.','Defina o ciclo e as datas de revisão.','Registre indicadores, frequência de acompanhamento e decisões de ajuste.']],
    lean:['Resuma um problema e seu plano de solução em uma estrutura A3 baseada em evidências.',['Explique o contexto e a importância do problema.','Apresente dados e o fluxo atual do processo.','Defina o resultado desejado e como será medido.','Investigue as causas do desvio entre situação atual e meta.','Proponha ações para tratar as causas identificadas.','Defina sequência, responsáveis e prazos das ações.','Planeje como medir os efeitos e padronizar o que funcionar.']],
    design:['Desenvolva soluções a partir das necessidades das pessoas, testando hipóteses antes de ampliar.',['Identifique o desafio e as pessoas afetadas.','Registre entrevistas, observações e necessidades do público.','Formule um desafio claro com base nos aprendizados.','Liste alternativas e critérios para escolher uma solução.','Descreva uma versão simples para testar sua hipótese.','Defina testes, feedback esperado e próximos ajustes.']]
  };
  const projectMethodExamples={
    simple:['Use para organizar uma entrega com começo, fim e responsabilidades claras. Defina o objetivo, as entregas, os responsáveis, o cronograma e os critérios de sucesso. É adequado quando o trabalho não exige uma metodologia específica.','Organizar uma reunião de planejamento docente: definir a pauta e o resultado esperado, reservar o espaço, preparar os materiais, atribuir responsáveis e confirmar a realização.'],
    pdca:['PDCA significa Planejar, Executar, Verificar e Agir. É um ciclo de melhoria contínua: entenda o problema, estabeleça uma meta, teste as ações, compare os resultados e ajuste ou padronize o processo. O ciclo pode ser repetido até alcançar uma melhoria consistente.','Reduzir erros na folha docente: levantar os tipos de erro, testar uma conferência prévia, comparar os erros antes e depois e incorporar ao processo a conferência que funcionou.'],
    fivew:['5W2H é uma ferramenta para detalhar um plano de execução por sete perguntas: o quê, por quê, onde, quando, quem, como e quanto custa. Ajuda a transformar uma decisão em ações claras e a identificar informações que ainda precisam ser definidas.','Revisar a carga horária docente: especificar o que será conferido, a razão da revisão, quais cursos serão envolvidos, o prazo, os responsáveis, o procedimento de conferência e os recursos necessários.'],
    action:['O plano de ação desdobra um objetivo em atividades executáveis. Para cada ação, defina responsável, prazo, recursos e forma de acompanhamento. Priorize as atividades e explicite dependências para que a equipe saiba o que fazer e em que ordem.','Regularizar matrículas pendentes: listar os casos, conferir os documentos, contatar os alunos, resolver impedimentos e acompanhar quantas pendências foram encerradas.'],
    process:['A melhoria de processo analisa como o trabalho acontece e identifica causas de falhas, desperdícios e atrasos. Mapeie a situação atual, investigue as causas, proponha mudanças e acompanhe indicadores para verificar o efeito das melhorias.','Agilizar a aprovação de turmas: mapear solicitação, conferência e aprovação; identificar onde as demandas ficam paradas; testar um fluxo mais claro e medir o tempo de resposta.'],
    academic:['Um projeto acadêmico organiza uma iniciativa de ensino, pesquisa ou extensão. Apresente a justificativa, os objetivos, a metodologia, o cronograma e os resultados esperados. As atividades devem estar alinhadas aos objetivos e permitir avaliar a contribuição acadêmica.','Criar uma ação de extensão sobre saúde preventiva: justificar a necessidade, definir o público e os objetivos, planejar oficinas, organizar a participação de docentes e estudantes e avaliar os resultados da ação.'],
    scrum:['Scrum é uma estrutura de trabalho para desenvolver soluções complexas em ciclos curtos chamados sprints. A equipe organiza um backlog, define o objetivo de cada sprint, entrega incrementos utilizáveis e faz revisões e retrospectivas para aprender e ajustar o trabalho.','Desenvolver um portal docente: priorizar funcionalidades no backlog, selecionar uma entrega para cada sprint, demonstrar o resultado aos usuários e ajustar as próximas prioridades com base no feedback.'],
    okr:['OKR conecta um objetivo a resultados-chave mensuráveis. O objetivo descreve a mudança desejada; os resultados-chave mostram como medir seu alcance. As iniciativas são as ações realizadas para influenciar esses resultados. Acompanhe o avanço durante um período definido.','Melhorar a organização da oferta de turmas: definir o objetivo e resultados-chave como diminuir solicitações devolvidas ou reduzir o tempo de aprovação, com metas e valores de referência a validar com a equipe.'],
    lean:['A3 / Lean organiza a resolução de um problema em uma narrativa concisa, tradicionalmente resumida em uma folha A3. Apresente contexto, situação atual, meta, causas, contramedidas, plano de ação e verificação. Use evidências para conectar o problema às ações propostas.','Diminuir retrabalho em contratos docentes: registrar onde ocorrem devoluções, investigar as causas, propor uma conferência de documentos e verificar se o número de devoluções diminui.'],
    design:['Design Thinking desenvolve soluções a partir das necessidades das pessoas. Investigue o público com empatia, defina o desafio, explore ideias, construa protótipos e teste com usuários. As etapas podem ser revisitadas conforme os testes revelam novos aprendizados.','Melhorar a solicitação de ajustes de carga horária: conversar com docentes e coordenadores, identificar dificuldades, desenhar um formulário simples, testar um protótipo com alguns usuários e ajustar a solução antes de ampliá-la.']
  };
  const projectAssessment={problem:'',people:'',constraints:'',startDate:'',endDate:'',areaId:'',busy:false,result:null};
  function renderProjectAssessment(){const a=projectAssessment;return pageHead('Avaliação Gemini','Descreva o desafio. O Gemini ajuda a escolher o método e montar o projeto.')+`<form id="project-assessment-form" class="project-editor"><section class="card project-method-intro"><span class="gemini-status"><img src="./assets/gemini.svg" alt="" width="24" height="24">Seu ponto de partida</span><h2>Qual problema vamos resolver?</h2><p>Você não precisa escolher a metodologia antes de começar. Informe o que acontece hoje, o resultado desejado e as condições de execução.</p></section><section class="card">${assessmentTextField('problem','Problema e resultado esperado',a.problem,6000,6)}<div class="project-editor-basics"><label class="field">Área<select name="areaId">${projOption(a.areaId,false)}</select></label><label class="field">Início previsto<input type="date" name="startDate" value="${html(a.startDate)}"></label><label class="field">Prazo final<input type="date" name="endDate" value="${html(a.endDate)}"></label></div>${assessmentTextField('people','Pessoas e equipes envolvidas',a.people,1500,3)}${assessmentTextField('constraints','Recursos, limitações e informações importantes',a.constraints,2500,3)}<p id="assessment-status" role="status" class="field-help"></p><button type="submit" class="button primary"><img src="./assets/gemini.svg" alt="" width="18" height="18"> Avaliar e sugerir modelos</button></section>${a.result?`<section class="card project-assessment-results"><h2 class="sectiontitle">Avaliação do seu desafio</h2><p class="project-description">${html(a.result.summary)}</p><div class="project-recommendations">${(Array.isArray(a.result.recommendations)?a.result.recommendations:[]).filter(recommendation=>Object.hasOwn(projectModels,recommendation?.modelId)).map((recommendation,i)=>`<article><span class="pill">${i===0?'Principal recomendação':'Alternativa / complemento'}</span><h3>${html(projectModels[recommendation.modelId].name)}</h3><p class="project-description">${html(recommendation.reason)}</p><h4>Por onde começar</h4><p class="project-description">${html(recommendation.firstSteps)}</p><button type="button" class="button primary" data-use-recommendation="${html(recommendation.modelId)}">Montar com este modelo →</button></article>`).join('')}</div><p class="field-help">As recomendações são propostas para sua decisão. Revise o plano gerado antes de salvar.</p></section>`:''}</form>`;}
  function assessmentTextField(name,label,value,max,rows){return `<label class="field">${html(label)}<textarea name="${name}" maxlength="${max}" rows="${rows}">${html(value)}</textarea><button type="button" class="button small" data-assessment-improve="${name}"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Melhorar com Gemini</button></label>`;}
  document.addEventListener('input',event=>{const field=event.target;if(field.closest('#project-assessment-form')&&Object.hasOwn(projectAssessment,field.name))projectAssessment[field.name]=field.value;});
  document.addEventListener('change',event=>{const field=event.target;if(field.closest('#project-assessment-form')&&Object.hasOwn(projectAssessment,field.name))projectAssessment[field.name]=field.value;});
  document.addEventListener('submit',async event=>{if(event.target.id!=='project-assessment-form')return;event.preventDefault();const a=projectAssessment,form=event.target;if(a.busy)return;const status=form.querySelector('#assessment-status');if(!a.problem.trim()){status.textContent='Descreva o problema primeiro.';form.elements.problem.focus();return;}if(a.startDate&&a.endDate&&a.endDate<a.startDate){status.textContent='O prazo final deve ser igual ou posterior ao início.';return;}
    a.busy=true;const controls=[...form.querySelectorAll('input,textarea,select,button')];controls.forEach(c=>c.disabled=true);status.textContent='Gemini está avaliando o desafio e comparando os modelos…';
    try{const result=await cloud.analyzeGmail({mode:'project-assess',subject:'Avaliação de metodologias para projeto',text:JSON.stringify({problem:a.problem,people:a.people,constraints:a.constraints,area:findProject(a.areaId)?.name||'',startDate:a.startDate,endDate:a.endDate}),areas:Object.entries(projectModels).map(([id,model])=>({id,name:model.name}))});if(!result.projectAssessment)throw new Error('O Gemini não retornou a avaliação. Tente novamente.');a.result=result.projectAssessment;if(view.page==='project-assessment'){a.busy=false;render();$('.project-assessment-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}
    catch(error){if(form.isConnected)status.textContent=error.message;}finally{a.busy=false;if(form.isConnected)controls.forEach(c=>c.disabled=false);}
  });
  async function improveAssessmentField(name){const a=projectAssessment,form=$('#project-assessment-form'),field=form?.elements.namedItem(name);if(!field||a.busy)return;const text=field.value.trim(),status=$('#assessment-status');if(!text){status.textContent='Escreva sua ideia neste campo primeiro.';field.focus();return;}a.busy=true;const controls=[...form.querySelectorAll('button')];controls.forEach(c=>c.disabled=true);field.disabled=true;status.textContent='Gemini está melhorando o texto…';try{const result=await cloud.analyzeGmail({mode:'rewrite',subject:'Ideia para avaliação de projeto',text,areas:[]});if(form.isConnected){if(!result.reply?.trim())throw new Error('O Gemini não retornou um texto.');field.value=result.reply.slice(0,field.maxLength);a[name]=field.value;status.textContent='Texto melhorado. Revise antes de avaliar.';}}catch(error){if(form.isConnected)status.textContent=error.message;}finally{a.busy=false;if(form.isConnected){field.disabled=false;controls.forEach(c=>c.disabled=false);}}}
  let projectDraft=null;
  function modelProject(modelKey='simple',existing=null){
    if(!projectModels[modelKey])modelKey='simple';
    projectDraft={id:existing?.id||null,name:existing?.name||'',description:existing?.description||'',areaId:existing?.areaId||view.areaId||'',model:modelKey,drafts:{[modelKey]:{...(existing?.sections||{})}},busy:false,owner:existing?.owner||'',resources:existing?.resources||'',startDate:existing?.startDate||'',endDate:existing?.endDate||'',phase:existing?.phase||'planning',milestones:structuredClone(existing?.milestones||[]),risks:structuredClone(existing?.risks||[]),indicators:structuredClone(existing?.indicators||[]),notes:structuredClone(existing?.notes||[]),history:structuredClone(existing?.history||[]),note:''};
    openPage('project-editor');
  }
  const projectGeminiButton=field=>`<button type="button" class="button small" data-project-improve="${field}"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Melhorar com Gemini</button>`;
  function projectTextField(name,label,value='',max=2000,rows=3){return `<label class="field">${html(label)}${rows===0?`<input name="${html(name)}" maxlength="${max}" value="${html(value)}">`:`<textarea name="${html(name)}" rows="${rows}" maxlength="${max}">${html(value)}</textarea>`}${projectGeminiButton(name)}</label>`;}
  function projectSelect(name,label,value,options){return `<label class="field">${html(label)}<select name="${html(name)}">${options.map(([key,text])=>`<option value="${key}" ${key===value?'selected':''}>${text}</option>`).join('')}</select></label>`;}
  function renderProjectTracking(){
    const d=projectDraft,tasks=d.id?db.tasks.filter(t=>t.initiativeId===d.id):[],done=tasks.filter(t=>t.status==='done').length,late=tasks.filter(t=>t.status!=='done'&&t.dueDate&&t.dueDate<localDate()).length;
    const filled=projectModels[d.model].fields.filter((_,i)=>d.drafts[d.model]?.[i]?.trim()).length,percent=tasks.length?Math.round(done/tasks.length*100):0;
    const phases=[['inbox','A classificar'],['todo','A fazer'],['doing','Em andamento'],['waiting','Aguardando'],['done','Concluídas']];
    const bars=phases.map(([key,label],i)=>{const count=tasks.filter(t=>workflow.stage(db,t)===key).length,width=tasks.length?count/tasks.length*260:0;return `<g><text x="0" y="${i*42+14}" fill="#526785" font-size="12">${label}: ${count}</text><rect x="140" y="${i*42}" width="260" height="20" rx="6" fill="#edf3fd"/><rect x="140" y="${i*42}" width="${width}" height="20" rx="6" fill="${key==='done'?'#274ea6':'#6190ed'}"/></g>`;}).join('');
    const dated=d.milestones.filter(m=>workflow.validDate(m.dueDate)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const times=dated.map(m=>new Date(m.dueDate+'T12:00:00').getTime()),min=Math.min(...times),span=Math.max(86400000,Math.max(...times)-min);
    return `<section class="project-dashboard" id="project-tracking"><div class="project-kpis"><div><small>Plano preenchido</small><strong>${filled}/${projectModels[d.model].fields.length}</strong><span>etapas com conteúdo</span></div><div><small>Tarefas concluídas</small><strong>${percent}%</strong><span>${done} de ${tasks.length} tarefas</span></div><div><small>Atrasadas</small><strong>${late}</strong><span>tarefas com prazo vencido</span></div><div><small>Marcos atingidos</small><strong>${d.milestones.filter(m=>m.done).length}/${d.milestones.length}</strong><span>entregas do projeto</span></div></div><div class="project-tracking-grid"><section class="card"><h2 class="sectiontitle">Execução das tarefas</h2><svg viewBox="0 0 410 212" role="img" aria-label="${html(phases.map(([key,label])=>label+': '+tasks.filter(t=>workflow.stage(db,t)===key).length).join('; '))}">${bars}</svg>${!tasks.length?'<p class="field-help">Vincule tarefas para acompanhar a execução. O preenchimento do plano não representa trabalho concluído.</p>':''}</section><section class="card"><h2 class="sectiontitle">Linha do tempo dos marcos</h2>${dated.length?`<svg viewBox="0 0 440 ${dated.length*42+20}" role="img" aria-label="Cronograma dos marcos por data">${dated.map((m,i)=>{const x=180+(times[i]-min)/span*230;return `<text x="0" y="${i*42+18}" font-size="11" fill="#526785">${html(m.name.slice(0,23))}</text><line x1="180" y1="${i*42+14}" x2="410" y2="${i*42+14}" stroke="#d6e2f6"/><circle cx="${x}" cy="${i*42+14}" r="6" fill="${m.done?'#274ea6':'#6190ed'}"/><text x="${Math.min(x,380)}" y="${i*42+33}" font-size="9" fill="#526785">${html(dateLabel(m.dueDate))}</text>`;}).join('')}</svg>`:'<p class="field-help">Defina as datas dos marcos abaixo para montar o cronograma.</p>'}</section></div></section><section class="card" id="project-milestones"><div class="between"><h2 class="sectiontitle">Marcos e entregas</h2>${button('+ Adicionar marco','project-add-row',false,'data-collection="milestones"')}</div><p class="field-help">Organize entregas, datas e responsáveis. Marque um marco apenas quando sua entrega estiver concluída.</p><div class="project-records">${d.milestones.map(m=>`<div class="project-record">${projectTextField('milestones:'+m.id+':name','Entrega / marco',m.name,200,0)}${projectTextField('milestones:'+m.id+':owner','Responsável',m.owner,150,0)}<label class="field">Prazo<input type="date" name="milestones:${html(m.id)}:dueDate" value="${html(m.dueDate)}"></label><label class="project-check"><input type="checkbox" name="milestones:${html(m.id)}:done" ${m.done?'checked':''}>Entrega concluída</label><div class="row">${button('Criar tarefa desta entrega','project-milestone-task',false,`data-id="${html(m.id)}"`)}${button('Remover marco','project-remove-row',false,`data-collection="milestones" data-id="${html(m.id)}"`)}</div></div>`).join('')||'<p class="field-help">Adicione a primeira entrega do projeto.</p>'}</div></section><section class="card" id="project-indicators"><div class="between"><h2 class="sectiontitle">Indicadores e metas</h2>${button('+ Adicionar indicador','project-add-row',false,'data-collection="indicators"')}</div><p class="field-help">Compare o valor inicial, a meta e o valor atual. Para metas de redução, use uma meta menor que o valor inicial.</p>${d.indicators.map(m=>{const baseline=Number(m.baseline),target=Number(m.target),current=Number(m.current),valid=[m.baseline,m.target,m.current].every(v=>v!==''&&Number.isFinite(Number(v)))&&target!==baseline,progress=valid?Math.max(0,Math.min(100,Math.round((current-baseline)/(target-baseline)*100))):null;return `<div class="project-record">${projectTextField('indicators:'+m.id+':name','Indicador',m.name,150,0)}${projectTextField('indicators:'+m.id+':unit','Unidade de medida',m.unit,60,0)}<div class="project-number-grid">${[['baseline','Valor inicial'],['target','Meta'],['current','Valor atual']].map(([key,label])=>`<label class="field">${label}<input type="number" step="any" name="indicators:${html(m.id)}:${key}" value="${html(m[key])}"></label>`).join('')}</div><div class="between"><span>${progress===null?'Preencha os valores para calcular o avanço.':progress+'% de avanço em direção à meta'}</span>${button('Remover indicador','project-remove-row',false,`data-collection="indicators" data-id="${html(m.id)}"`)}</div>${progress!==null?`<progress max="100" value="${progress}" aria-label="Avanço de ${html(m.name)}">${progress}%</progress>`:''}</div>`;}).join('')}</section><section class="card" id="project-risks"><div class="between"><h2 class="sectiontitle">Riscos e respostas</h2>${button('+ Adicionar risco','project-add-row',false,'data-collection="risks"')}</div><p class="field-help">Antecipe o que pode comprometer o projeto e defina como reduzir o impacto.</p>${d.risks.map(m=>`<div class="project-record">${projectTextField('risks:'+m.id+':title','Risco',m.title,200,0)}<div class="project-number-grid">${projectSelect('risks:'+m.id+':severity','Impacto',m.severity,[['low','Baixo'],['medium','Médio'],['high','Alto']])}${projectSelect('risks:'+m.id+':status','Situação',m.status,[['open','Em acompanhamento'],['resolved','Resolvido']])}</div>${projectTextField('risks:'+m.id+':mitigation','Resposta / prevenção',m.mitigation,2000)}${button('Remover risco','project-remove-row',false,`data-collection="risks" data-id="${html(m.id)}"`)}</div>`).join('')||'<p class="field-help">Registre os riscos relevantes para acompanhar durante a execução.</p>'}</section><section class="card" id="project-tasks"><div class="between"><h2 class="sectiontitle">Tarefas vinculadas</h2>${button('+ Nova tarefa','project-editor-task')}</div><p class="field-help">As tarefas seguem pela esteira e alimentam o gráfico de execução.</p>${tasks.map(t=>`<div class="project-task-row"><input type="checkbox" data-complete-task="${html(t.id)}" aria-label="Concluir ${html(t.title)}" ${t.status==='done'?'checked disabled':''}><button type="button" data-task="${html(t.id)}">${html(t.title)}</button>${badge(workflow.stage(db,t))}${urgencyBadge(t)}</div>`).join('')||'<p class="field-help">Nenhuma tarefa vinculada ainda.</p>'}<div class="row"><label class="field">Vincular tarefa existente<select id="project-link-task"><option value="">Escolha uma tarefa da área</option>${db.tasks.filter(t=>t.project===d.areaId&&!t.initiativeId).map(t=>`<option value="${html(t.id)}">${html(t.title)}</option>`).join('')}</select></label>${button('Vincular','project-link-task')}</div></section><section class="card" id="project-notes"><h2 class="sectiontitle">Acompanhamento e decisões</h2>${projectTextField('note','Nova atualização: avanços, decisões e próximos passos',d.note,2000)}<p class="field-help">A atualização será registrada ao salvar o projeto.</p>${d.notes.slice().reverse().map(n=>`<article class="project-note"><time>${html(new Date(n.at).toLocaleString('pt-BR'))}</time><p>${html(n.text)}</p></article>`).join('')}<details><summary>Histórico de salvamentos (${d.history.length})</summary>${d.history.slice().reverse().map(h=>`<p class="smalltext">${html(new Date(h.at).toLocaleString('pt-BR'))} · ${html(h.text)}</p>`).join('')}</details></section>`;
  }
  function renderProjectSuggestion(){const p=projectDraft.suggestion;if(!p)return '';return `<section class="card project-suggestion"><span class="gemini-status"><img src="./assets/gemini.svg" alt="" width="18" height="18">Proposta do Gemini para revisar</span><h2>${html(p.name)}</h2><p class="project-description">${html(p.description)}</p>${p.sections.map(s=>`<h3>${html(projectModels[projectDraft.model].fields[Number(s.id)]||'Etapa')}</h3><p class="project-description">${html(s.text)}</p>`).join('')}<h3>Marcos sugeridos</h3><ul>${p.milestones.map(m=>`<li>${html(m.name)}${m.dueDate?' · '+html(dateLabel(m.dueDate)):''}</li>`).join('')}</ul><h3>Riscos sugeridos</h3>${p.risks.map(r=>`<p><b>${html(r.title)}</b> — ${html(r.mitigation)}</p>`).join('')}<p class="field-help">Aplicar substitui o nome, a descrição, as etapas, os marcos e os riscos deste rascunho. Tarefas, indicadores e histórico são preservados.</p><div class="row">${button('Aplicar proposta ao rascunho','project-apply-plan',true)}${button('Descartar proposta','project-discard-plan')}</div></section>`;}
  async function generateProjectPlan(){
    const d=projectDraft,form=$('#project-editor-form');if(!d||!form||d.busy)return;
    if(!d.description.trim()&&!d.name.trim()){$('#project-model-status').textContent='Escreva o nome ou descreva a ideia do projeto primeiro.';form.elements.description.focus();return;}
    d.busy=true;const controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(c=>c.disabled=true);$('#project-model-status').textContent='Gemini está elaborando as etapas, entregas e riscos do projeto…';
    try{const result=await cloud.analyzeGmail({mode:'project-plan',subject:projectModels[d.model].name,text:JSON.stringify({name:d.name,description:d.description,startDate:d.startDate,endDate:d.endDate,people:d.owner,resources:d.resources,area:findProject(d.areaId)?.name||'',sections:Object.fromEntries(Object.entries(d.drafts[d.model]||{}).map(([key,value])=>[key,String(value).slice(0,700)]))}).slice(0,12000),areas:projectModels[d.model].fields.map((name,i)=>({id:String(i),name}))});if(projectDraft===d){if(!result.projectPlan)throw new Error('O Gemini não retornou o plano. Tente novamente.');d.suggestion=result.projectPlan;d.busy=false;if(view.page==='project-editor'){render();$('.project-suggestion')?.scrollIntoView({behavior:'smooth',block:'start'});}}}
    catch(error){if(form.isConnected)$('#project-model-status').textContent=error.message;}
    finally{d.busy=false;if(form.isConnected)controls.forEach(c=>c.disabled=false);}
  }
  function exportProjectReport(){
    const d=projectDraft;if(!d)return;const model=projectModels[d.model],tasks=db.tasks.filter(t=>t.initiativeId===d.id);
    const body=`<h1>${html(d.name||'Projeto')}</h1><p>${html(model.name)} · ${html(findProject(d.areaId)?.name||'')}</p><p>${html(d.description)}</p><p>Responsável: ${html(d.owner)} · Início: ${html(d.startDate)} · Prazo: ${html(d.endDate)}</p><p>Recursos e restrições: ${html(d.resources)}</p>${model.fields.map((label,i)=>`<h2>${html(label)}</h2><p>${html(d.drafts[d.model]?.[i]||'Não preenchido')}</p>`).join('')}<h2>Marcos</h2>${d.milestones.map(m=>`<p>${m.done?'✓':'○'} ${html(m.name)} · ${html(m.dueDate)} · ${html(m.owner)}</p>`).join('')}<h2>Indicadores</h2>${d.indicators.map(m=>`<p>${html(m.name)} (${html(m.unit)}): inicial ${html(m.baseline)}, atual ${html(m.current)}, meta ${html(m.target)}</p>`).join('')}<h2>Riscos</h2>${d.risks.map(m=>`<p><b>${html(m.title)}</b>: ${html(m.mitigation)}</p>`).join('')}<h2>Tarefas</h2>${tasks.map(t=>`<p>${html(t.title)} · ${html(nameOfStatus[t.status]||'A classificar')} · ${html(t.dueDate)}</p>`).join('')}<h2>Atualizações</h2>${d.notes.map(n=>`<p>${html(new Date(n.at).toLocaleString('pt-BR'))}: ${html(n.text)}</p>`).join('')}`;
    const blob=new Blob([`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${html(d.name||'Projeto')}</title><style>body{font-family:Arial;color:#182b49;max-width:850px;margin:40px auto;padding:20px;font-size:13px;line-height:1.7}h1{color:#3166dc}h2{font-size:17px;margin-top:28px}p{white-space:pre-wrap}@media print{body{margin:0}h2{break-after:avoid}}</style>${body}</html>`],{type:'text/html'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ulbraflow-projeto.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function renderProjectEditor(){
    if(!projectDraft)return renderMyProjects();const d=projectDraft,model=projectModels[d.model],guide=projectGuides[d.model];
    return pageHead(d.id?d.name||'Meu projeto':'Novo projeto · '+model.name,'Desenvolva cada etapa, revise o conteúdo e salve o projeto.',`<div class="row">${button('← Meus projetos','project-editor-back')}${button('Exportar relatório','project-export')}</div>`)+`<form id="project-editor-form" class="project-editor">${renderProjectSuggestion()}<section class="card project-method-intro"><span class="label">MODELO DE PROJETO</span><h2>${html(model.name)}</h2><details class="project-method-accordion"><summary>Descrição, metodologia e exemplo</summary><div><h3>Descrição</h3><p>${html(guide[0])}</p><h3>Explicação da metodologia</h3><p>${html(projectMethodExamples[d.model][0])}</p><h3>Exemplo prático</h3><p>${html(projectMethodExamples[d.model][1])}</p><p class="smalltext muted">Exemplo ilustrativo. Adapte os responsáveis, as metas e os prazos à sua realidade.</p><a class="button method-google-search" href="https://www.google.com/search?q=${encodeURIComponent(model.name+' metodologia exemplos aplicados gestão acadêmica')}" target="_blank" rel="noopener noreferrer">⌕ Buscar exemplos aplicados no Google ↗</a><div><a class="button method-google-search" href="https://www.youtube.com/results?search_query=${encodeURIComponent(model.name+' metodologia exemplos aplicados')}" target="_blank" rel="noopener noreferrer">▶ Buscar vídeos no YouTube ↗</a></div></div></details><div class="row project-generator-actions"><button type="button" class="button primary" data-action="project-generate"><img src="./assets/gemini.svg" alt="" width="18" height="18"> Gerar plano com Gemini</button><span class="smalltext">Escreva sua ideia na descrição e receba uma proposta para revisar.</span></div><div class="project-steps-index"><a href="#project-tracking">Acompanhamento</a><a href="#project-milestones">Marcos</a><a href="#project-indicators">Indicadores</a><a href="#project-risks">Riscos</a>${model.fields.map((label,i)=>`<a href="#project-step-${i}"><b>${i+1}</b>${html(label.split(':')[0])}</a>`).join('')}</div></section><section class="card"><h2 class="sectiontitle">Sobre o projeto</h2><div class="project-editor-basics"><label class="field">Nome do projeto<input name="name" required maxlength="100" value="${html(d.name)}">${projectGeminiButton('name')}</label><label class="field">Área<select name="areaId" required>${projOption(d.areaId,false)}</select></label><label class="field">Modelo<select name="model">${Object.entries(projectModels).map(([key,item])=>`<option value="${key}" ${key===d.model?'selected':''}>${item.name}</option>`).join('')}</select></label></div><div class="project-editor-basics">${projectTextField('owner','Responsável pelo projeto',d.owner,150,0)}<label class="field">Início<input type="date" name="startDate" value="${html(d.startDate)}"></label><label class="field">Prazo do projeto<input type="date" name="endDate" value="${html(d.endDate)}"></label>${projectSelect('phase','Situação do projeto',d.phase,[['planning','Planejamento'],['active','Em execução'],['waiting','Aguardando'],['done','Concluído']])}</div>${projectTextField('resources','Recursos e restrições',d.resources,2000)}<label class="field">Descrição do projeto<p class="field-help">Apresente o contexto, a finalidade e quem será beneficiado.</p><textarea name="description" rows="4" maxlength="2000" placeholder="Descreva sua ideia e por que este projeto é necessário…">${html(d.description)}</textarea>${projectGeminiButton('description')}</label></section><div class="project-step-cards">${model.fields.map((label,index)=>`<section class="card project-step-card" id="project-step-${index}"><div class="project-step-heading"><span>${String(index+1).padStart(2,'0')}</span><h2>${html(label)}</h2></div><p class="field-help">${html(guide[1][index])}</p><label class="field"><span class="sr-only">${html(label)}</span><textarea name="section-${index}" rows="5" maxlength="4000" placeholder="${html(guide[1][index])}">${html(d.drafts[d.model]?.[index]||'')}</textarea></label>${projectGeminiButton('section-'+index)}</section>`).join('')}</div>${renderProjectTracking()}<footer class="project-editor-footer"><p id="project-model-status" role="status">Preencha as etapas no seu ritmo. Você pode salvar o projeto ainda em construção.</p><button type="submit" class="button primary">${d.id?'Salvar alterações':'Criar projeto'}</button></footer></form>`;
  }
  function updateProjectDraft(field){
    if(!projectDraft||!field.closest('#project-editor-form'))return;
    if(field.name.startsWith('section-')){projectDraft.drafts[projectDraft.model]??={};projectDraft.drafts[projectDraft.model][field.name.slice(8)]=field.value;}
    else if(field.name.includes(':')){const [collection,id,key]=field.name.split(':');const row=projectDraft[collection]?.find?.(item=>item.id===id);if(row)row[key]=field.type==='checkbox'?field.checked:field.value;}
    else if(['name','description','areaId','owner','startDate','endDate','phase','note','resources'].includes(field.name))projectDraft[field.name]=field.value;
    if(field.name.startsWith('indicators:')){const row=projectDraft.indicators.find(item=>item.id===field.name.split(':')[1]),record=field.closest('.project-record');if(row&&record){const values=[row.baseline,row.target,row.current],valid=values.every(v=>v!==''&&Number.isFinite(Number(v)))&&Number(row.target)!==Number(row.baseline),progress=valid?Math.max(0,Math.min(100,Math.round((Number(row.current)-Number(row.baseline))/(Number(row.target)-Number(row.baseline))*100))):null;record.querySelector('.between span').textContent=progress===null?'Preencha os valores para calcular o avanço.':progress+'% de avanço em direção à meta';let bar=record.querySelector('progress');if(progress===null)bar?.remove();else{if(!bar){bar=document.createElement('progress');bar.max=100;record.appendChild(bar);}bar.value=progress;bar.setAttribute('aria-label','Avanço de '+row.name);}}}
  }
  document.addEventListener('input',event=>updateProjectDraft(event.target));
  document.addEventListener('change',event=>{
    const field=event.target;if(!field.closest('#project-editor-form')||!projectDraft)return;
    if(field.name==='model'){projectDraft.model=field.value;projectDraft.suggestion=null;render();}else updateProjectDraft(field);
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='project-editor-form')return;event.preventDefault();const d=projectDraft;if(!d||d.busy)return;
    const form=event.target;for(const field of form.querySelectorAll('input,select,textarea'))updateProjectDraft(field);
    if(!d.name.trim()||!findProject(d.areaId))return;
    if(d.startDate&&d.endDate&&d.endDate<d.startDate){$('#project-model-status').textContent='O prazo do projeto deve ser igual ou posterior à data de início.';return;}
    if(d.note.trim()){d.notes.push({id:uuid(),at:Date.now(),text:d.note.trim().slice(0,2000)});d.notes=d.notes.slice(-100);d.note='';}
    d.history.push({at:Date.now(),text:d.id?'Projeto atualizado':'Projeto criado'});d.history=d.history.slice(-50);
    let project=db.initiatives.find(item=>item.id===d.id);const values={name:d.name.trim(),areaId:d.areaId,description:d.description,model:d.model,sections:{...(d.drafts[d.model]||{})},owner:d.owner,resources:d.resources,startDate:d.startDate,endDate:d.endDate,phase:d.phase,milestones:structuredClone(d.milestones),risks:structuredClone(d.risks),indicators:structuredClone(d.indicators),notes:structuredClone(d.notes),history:structuredClone(d.history),updatedAt:Date.now()};
    if(project){Object.assign(project,values);db.tasks.filter(t=>t.initiativeId===project.id).forEach(t=>{t.project=d.areaId;});}
    else{project={id:uuid(),createdAt:Date.now(),...values};db.initiatives.push(project);d.id=project.id;}
    persistNow();render();$('#project-model-status').textContent='Projeto salvo. Você pode continuar editando.';notice('Projeto salvo.');
  });
  async function improveProjectField(fieldName){
    const d=projectDraft,form=$('#project-editor-form');if(!d||!form||d.busy)return;
    const field=form.elements.namedItem(fieldName),text=field?.value.trim(),status=$('#project-model-status');if(!text){status.textContent='Escreva sua ideia neste campo primeiro.';field?.focus();return;}
    const label=fieldName==='name'?'Nome do projeto':fieldName==='description'?'Descrição do projeto':fieldName.startsWith('section-')?projectModels[d.model].fields[Number(fieldName.slice(8))]:field.closest('label')?.childNodes[0]?.textContent?.trim()||'Texto do projeto';
    d.busy=true;field.disabled=true;form.querySelectorAll('[data-project-improve], [type="submit"],select[name="model"],[data-action="project-generate"]').forEach(control=>control.disabled=true);status.textContent='Gemini está melhorando '+label.toLowerCase()+'…';
    try{const result=await cloud.analyzeGmail({mode:fieldName==='name'?'project-title':'rewrite',subject:(projectModels[d.model].name+' · '+label).slice(0,300),text,areas:[]});if(projectDraft===d&&form.isConnected){if(!result.reply?.trim())throw new Error('O Gemini não retornou um texto.');field.value=result.reply.trim().slice(0,Number(field.maxLength)||4000);updateProjectDraft(field);status.textContent='Texto melhorado. Revise e salve quando estiver pronto.';}}
    catch(error){if(form.isConnected)status.textContent=error.message;}
    finally{d.busy=false;if(form.isConnected){field.disabled=false;form.querySelectorAll('[data-project-improve], [type="submit"],select[name="model"],[data-action="project-generate"]').forEach(control=>control.disabled=false);}}
  }
  function renderArea(){
    const area=findProject(view.areaId);if(!area)return pageHead('Área não encontrada','Volte às áreas.',button('← Áreas','show-areas'));
    const tasks=db.tasks.filter(t=>t.project===area.id),projects=(db.initiatives||[]).filter(p=>p.areaId===area.id);
    const taskRows=list=>list.map(t=>`<button class="task-list-item" data-task="${html(t.id)}"><strong>${html(t.title)}</strong><div class="status-line">${badge(workflow.stage(db,t))}${urgencyBadge(t)}</div></button>`).join('')||'<p class="smalltext muted">Nenhuma tarefa aqui ainda.</p>';
    return pageHead(area.name,'Tarefas e projetos desta área. Todas as demandas seguem pela esteira.',`<div class="row">${button('← Áreas','show-areas')}${button('+ Criar projeto','new-initiative')}${button('+ Nova tarefa','area-new-task',true)}</div>`)+`<section class="card"><h3 class="sectiontitle">Tarefas da área</h3>${taskRows(tasks.filter(t=>!projects.some(p=>p.id===t.initiativeId)))}</section><div class="area-projects">${projects.map(p=>`<section class="card"><div class="between"><h3 class="sectiontitle">${html(p.name)}</h3><div class="row">${button('Abrir projeto','edit-model-project',false,`data-id="${html(p.id)}"`)}${button('Excluir projeto','delete-initiative',false,`data-id="${html(p.id)}"`)}${button('Renomear','rename-initiative',false,`data-id="${html(p.id)}"`)}${button('+ Nova tarefa','initiative-new-task',false,`data-id="${html(p.id)}"`)}</div></div>${p.description?`<p class="smalltext muted">${html(p.description)}</p>`:''}${taskRows(tasks.filter(t=>t.initiativeId===p.id))}</section>`).join('')}</div>`;
  }
  function newInitiative(){if(findProject(view.areaId))modelProject('simple');}
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
    const connection=calendar.connected?`<div class="calendar-compact-row"><details><summary>● Google Agenda conectado</summary><p>Compromissos da agenda principal e tarefas do UlbraFlow. Atualiza enquanto o UlbraFlow está aberto.</p>${button('Desconectar','calendar-disconnect')}</details>${button(calendar.reading||calendar.status==='syncing'?'Sincronizando…':'Sincronizar','calendar-sync')}</div>`:`<div class="calendar-compact-row"><span>Google Agenda</span>${button('Conectar','calendar-connect',true)}</div>`;
    return pageHead('Agenda','Suas tarefas e os compromissos do Google no mesmo calendário.',`<div class="agenda-head-actions"><section class="calendar-connection">${connection}${calendar.error?`<p class="sync-error">${html(calendar.error)}</p>`:''}${calendar.readError?`<p class="sync-error">${html(calendar.readError)}</p>`:''}</section></div>`)+`<section class="agenda-week-nav"><div class="calendar-toolbar"><strong>${range}</strong><div class="row">${button('←','week-previous')}${button('Semana atual','week-reset')}${button('→','week-next')}</div></div></section><div class="calendar-grid">${days.map((d,i)=>{const date=localDate(d);const matches=db.tasks.filter(t=>t.plannedDate===date).sort((a,b)=>(a.plannedTime||'').localeCompare(b.plannedTime||''));return `<div class="calendar-day"><small>${['SEG','TER','QUA','QUI','SEX','SÁB','DOM'][i]}</small><strong>${d.getDate()}</strong>${matches.map(t=>`<button data-task="${html(t.id)}" class="calendar-event"><time>${html(t.plannedTime||'Dia inteiro')}</time>${html(t.title)}</button>`).join('')}${calendar.events.filter(e=>{const start=new Date(d);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return e.start.date?e.start.date<localDate(end)&&e.end.date>date:new Date(e.start.dateTime)<end&&new Date(e.end.dateTime)>start}).map(e=>`<div class="calendar-event google-calendar-event"><time>${html(e.start.date?'Dia inteiro':new Date(e.start.dateTime).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))} · Google</time>${html(e.summary||'Sem título')}</div>`).join('')}</div>`}).join('')}</div><p class="board-footnote">O evento usa a <b>data de execução</b>. O <b>prazo final</b> permanece separado, na descrição. Sem horário, o evento ocupa o dia inteiro; com horário, usa a duração do seu ciclo de foco. A exportação .ics continua disponível nos detalhes da tarefa.</p>`;
  }
  function timeReport(){return globalThis.FlowTime.summarize(db,view.timePeriod,view.timeOffset)}
  function renderTime(){
    const report=timeReport(), duration=globalThis.FlowTime.duration;
    const last=new Date(+report.end-1);
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
    flushPersist();let legacy;try{legacy=JSON.parse(localStorage.getItem('flow.workspace.v1'))}catch{}
    if(legacy?.version!==1||!Array.isArray(legacy.tasks)||!Array.isArray(legacy.projects)){notice('Nenhuma base anterior encontrada neste navegador. Você também pode importar um backup.');return}
    if(!confirm('Acrescentar as tarefas deste navegador à conta Google atual? Os dados locais serão preservados.'))return;
    let imported;try{imported=normalizeWorkspace(legacy);workflow.reconcile(imported)}catch{notice('A base deste navegador não pôde ser lida. Exporte um backup dela antes de tentar novamente.');return}
    if(imported.focus)workflow.cancel(imported,imported.focus.taskId);
    // Áreas arquivadas continuam arquivadas; IDs que colidem com outro conteúdo recebem um novo ID.
    const areaIds=new Map(),projectIds=new Map(),taskIds=new Map(),taken=id=>db.initiatives.some(p=>p.id===id)||db.projectTrash.some(entry=>entry.project.id===id);
    for(const [list,archived] of [[imported.projects,false],[imported.archivedProjects||[],true]])for(const p of list){
      const current=findProject(p.id);let id=p.id;
      if(current&&current.name!==p.name)id=uuid();
      if(!current||id!==p.id)(archived?(db.archivedProjects??=[]):db.projects).push({...p,id});
      areaIds.set(p.id,id);
    }
    for(const p of imported.initiatives){
      // Mesmo projeto (inclusive de uma importação anterior com ID trocado): as tarefas apontam para ele.
      const areaId=areaIds.get(p.areaId)||p.areaId,same=db.initiatives.find(item=>item.name===p.name&&item.areaId===areaId&&(item.id===p.id||item.createdAt===p.createdAt));
      if(same){projectIds.set(p.id,same.id);continue}
      const id=taken(p.id)?uuid():p.id;db.initiatives.push({...p,id,areaId});projectIds.set(p.id,id);
    }
    let count=0;
    for(const task of imported.tasks){
      const duplicate=db.tasks.find(t=>t.id===task.id&&t.createdAt===task.createdAt&&t.title===task.title||JSON.stringify(t)===JSON.stringify(task)||(task.gmailCaptureId&&t.gmailCaptureId===task.gmailCaptureId));
      if(duplicate){taskIds.set(task.id,duplicate.id);continue}
      const id=findTask(task.id)?uuid():task.id;taskIds.set(task.id,id);
      // Projeto ausente da base anterior: a tarefa fica livre para ser vinculada de novo.
      db.tasks.push({...task,id,project:areaIds.get(task.project)||task.project,initiativeId:projectIds.get(task.initiativeId)||null});count++;
    }
    for(const entry of imported.projectTrash){
      if(db.projectTrash.some(item=>item.deletedAt===entry.deletedAt&&item.project.name===entry.project.name))continue;
      db.projectTrash.push({...entry,project:{...entry.project,id:taken(entry.project.id)?uuid():entry.project.id,areaId:areaIds.get(entry.project.areaId)||entry.project.areaId},taskIds:(Array.isArray(entry.taskIds)?entry.taskIds:[]).map(id=>taskIds.get(id)).filter(Boolean)});
    }
    persistAndRender();closeModal();notice(`${count} tarefas acrescentadas. Cronômetros importados ficam pausados.`);
  }
  function updateAccount(){
    const account=cloud.info(), labels={saved:'Salvo na nuvem',pending:'Salvamento pendente',saving:'Salvando…',error:'Falha ao salvar',conflict:'Conflito de alterações'};
    $('#account-button').textContent=account.mode==='cloud'?(labels[account.status]||'Conta Google'):'Entrar com Google';
    $('#account-button').title=account.error||account.user?.email||'Conectar sua conta Google';
    $('.sidebar-foot strong').textContent=account.user?.email||'Meu workspace';
    $('.sidebar-foot small').textContent=account.mode==='cloud'?'Google · Supabase':'UlbraFlow · neste navegador';
  }
  async function composeReply(threadId){
    try{const email=await FlowGmailReview.replyContext(threadId),me=cloud.info().user?.email?.toLowerCase(),sender=FlowGmailReview.address(email.sender),recipient=sender.toLowerCase()===me?FlowGmailReview.address(email.recipient):sender;
    promptModal({title:'Responder e-mail',subtitle:email.subject,content:`<label class="field">Para<input name="to" type="email" required value="${html(recipient)}" /></label><label class="field">Sua ideia<textarea name="idea" rows="3" maxlength="4000" placeholder="Escreva ou dite o que quer responder"></textarea></label><div class="row"><button type="button" class="button" id="reply-dictate">🎙 Ditar ideia</button><button type="button" class="button" id="reply-rewrite"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Reescrever com Gemini</button></div><label class="field">Resposta para revisar<textarea name="message" required rows="8" maxlength="20000"></textarea></label><label class="field">Anexos · até 10 MB no total<input type="file" name="attachments" multiple /></label><p class="smalltext muted">O botão Enviar resposta envia o e-mail pela sua conta Gmail.</p><p id="reply-status" role="status"></p>`,onSubmit:()=>false,ok:'Enviar resposta'});
    const form=$('#active-modal-form');let sending=false;
    const status=form.querySelector('#reply-status'),dictate=form.querySelector('#reply-dictate'),rewrite=form.querySelector('#reply-rewrite');
    dictate.addEventListener('click',()=>{
      if(activeDictation){activeDictation.stop();return;}
      const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){status.textContent='Ditado indisponível neste navegador. Use o Chrome ou o microfone do teclado do celular.';return;}
      const speech=new Recognition(),prefix=form.elements.idea.value;activeDictation=speech;speech.lang='pt-BR';speech.continuous=true;speech.interimResults=false;
      speech.onresult=event=>{if(form.isConnected)form.elements.idea.value=(prefix+' '+Array.from(event.results).filter(r=>r.isFinal).map(r=>r[0].transcript).join(' ')).trim().slice(0,4000);};
      speech.onerror=event=>{if(form.isConnected)status.textContent=event.error==='not-allowed'?'Permita o microfone no navegador para ditar.':'Não foi possível concluir o ditado. Você pode escrever sua ideia.';};
      speech.onend=()=>{if(activeDictation===speech)activeDictation=null;if(form.isConnected){dictate.textContent='🎙 Ditar ideia';rewrite.disabled=false;}};
      try{speech.start();dictate.textContent='■ Parar ditado';rewrite.disabled=true;status.textContent='Ouvindo… O ditado usa o reconhecimento de voz do navegador.';}catch{activeDictation=null;status.textContent='Não foi possível iniciar o microfone.';}
    });
    rewrite.addEventListener('click',async()=>{const idea=form.elements.idea.value.trim()||form.elements.message.value.trim();if(!idea){status.textContent='Escreva ou dite sua ideia primeiro.';return;}if(sending)return;activeDictation?.stop();rewrite.disabled=true;dictate.disabled=true;const send=form.querySelector('[type="submit"]');send.disabled=true;form.elements.message.disabled=true;status.textContent='Gemini está preparando o rascunho…';
      try{const result=await cloud.analyzeGmail({mode:'reply',subject:email.subject.slice(0,300),text:('Ideia do usuário:\n'+idea+'\n\nContexto do e-mail:\n'+(email.text||db.gmailReviews?.[email.id]?.summary||email.snippet||'').slice(0,7500)).slice(0,12000),areas:[]});if(form.isConnected){form.elements.message.value=result.reply;status.textContent='Rascunho pronto. Revise antes de enviar.';}}
      catch(error){if(form.isConnected)status.textContent=error.message;}finally{if(form.isConnected){rewrite.disabled=false;dictate.disabled=false;send.disabled=false;form.elements.message.disabled=false;}}
    });
    form.addEventListener('submit',async event=>{event.preventDefault();if(sending||rewrite.disabled)return;sending=true;const send=form.querySelector('[type="submit"]');send.disabled=true;const status=form.querySelector('#reply-status');status.textContent='Enviando…';
     try{await FlowGmailReview.reply(email,form.elements.to.value,form.elements.message.value,[...form.elements.attachments.files]);closeModal();notice('Resposta enviada pelo Gmail.');}catch(error){status.textContent=error.message;}finally{sending=false;send.disabled=false;}
    });}catch(error){notice(error.message)}
  }
  function renderAlerts(){
    const rows=[['Lembrar antes do vencimento','Planejado para a etapa de envio de e-mails.'],['Acompanhar tarefas atrasadas','Alerta para tarefas cujo prazo final já passou.'],['Resumo diário de tarefas','Consolidar as demandas previstas para cada dia.'],['Resumo semanal por área','Entregar um resumo de pendências por área.']];
    return pageHead('Alertas','Preferências de lembretes e acompanhamento.')+`<section class="card">${rows.map(([title,desc],i)=>`<div class="alertrow"><div><strong>${title}</strong><small>${desc}</small></div><button class="switch ${db.preferences.alerts[i]===true?'on':''}" data-alert="${i}" role="switch" aria-checked="${db.preferences.alerts[i]===true}" aria-label="${title}"></button></div>`).join('')}<label class="field" style="max-width:310px;margin-top:19px">Antecedência do lembrete<select id="reminder-days">${[1,2,3,7].map(n=>`<option value="${n}" ${db.preferences.reminderDays===n?'selected':''}>${n} ${n===1?'dia':'dias'} antes</option>`).join('')}</select></label></section><div class="notice" style="margin-top:15px">Esta tela já grava suas preferências. O envio automático por e-mail <b>ainda não está ativado</b>; ele dependerá da autenticação, do servidor e do serviço de notificações.</div>`;
  }
  function tick(){
    if(workflow.reconcile(db)){persist();render();notice(db.focus?.phase==='break'?'Ciclo concluído. Hora de uma pausa.':'Pausa concluída. Comece o próximo ciclo quando estiver pronto.');return}
    const focus=db.focus, el=$('#active-clock');
    if(el){el.classList.toggle('running',!!focus?.endsAt);el.textContent=focus?`${focus.phase==='work'?'◉ Foco':focus.phase==='break'?'◷ Pausa':'✓ Próximo ciclo'} · ${countdown(workflow.remaining(db))}`:'◉ Entrar em foco'}
    document.querySelectorAll('[data-time]').forEach(x=>{const t=findTask(x.dataset.time);if(t)x.textContent=secondsLabel(sessionSeconds(t))});
    document.querySelectorAll('[data-countdown]').forEach(x=>x.textContent=countdown(workflow.remaining(db)));
    const ring=$('.focus-ring');if(ring)ring.style.setProperty('--progress',`${focus?Math.min(100,100*(1-workflow.remaining(db)/(focus.durationMs||1))):0}%`);
    if(view.page==='foco')document.title=`${focus?countdown(workflow.remaining(db))+' · ':''}UlbraFlow — Foco`;
  }
  // Retain unaffected cards and their input nodes during background Gmail updates.
  function patchGmailReview(){
    const section=$('.gmail-review-box');if(!section)return false;
    const template=document.createElement('template');template.innerHTML=renderGmailReview();const next=template.content.firstElementChild;
    const grid=section.querySelector('.gmail-review-grid'),nextGrid=next.querySelector('.gmail-review-grid');
    const key=node=>node.dataset.emailCard?'email:'+node.dataset.emailCard:node.dataset.entryCard?'manual:'+node.dataset.entryCard:'';
    const existing=new Map([...grid.children].filter(node=>key(node)).map(node=>[key(node),node]));
    let cursor=grid.firstElementChild;
    for(const fresh of [...nextGrid.children]){
      const old=existing.get(key(fresh));let node=fresh;
      if(old){existing.delete(key(fresh));if(old._renderedHTML===fresh.outerHTML)node=old;else{fresh._renderedHTML=fresh.outerHTML;old.replaceWith(fresh);if(cursor===old)cursor=fresh;}}
      else fresh._renderedHTML=fresh.outerHTML;
      if(node!==cursor)grid.insertBefore(node,cursor);cursor=node.nextElementSibling;
    }
    while(cursor){const next=cursor.nextElementSibling;cursor.remove();cursor=next;}
    for(const stale of existing.values())stale.remove();
    // Update the small controls/status separately; the grid remains attached to the document.
    const childKey=node=>node.classList.contains('gmail-review-grid')?'grid':node.classList.contains('between')?'header':node.classList.contains('sync-error')?'error':node.dataset.action||'description';
    const children=new Map([...section.children].map(node=>[childKey(node),node]));cursor=section.firstElementChild;
    for(const fresh of [...next.children]){
      const k=childKey(fresh),old=children.get(k);children.delete(k);let node=k==='grid'?grid:fresh;
      if(k!=='grid'&&old){if(old.isEqualNode(fresh))node=old;else{old.replaceWith(fresh);if(cursor===old)cursor=fresh;}}
      if(node!==cursor)section.insertBefore(node,cursor);cursor=node.nextElementSibling;
    }
    for(const stale of children.values())stale.remove();
    return true;
  }
  function renderFailure(title,text,error){$('#screen').innerHTML=pageHead(title,text)+`<section class="card startup-access render-failure"><p class="sync-error" role="alert">Algo nos dados impediu a exibição.${error?.message?' Detalhe técnico: '+html(error.message):''}</p><div class="actionbar">${button('⚙ Dados do UlbraFlow','settings',true)}${button('Abrir Entrada','show-inbox')}</div></section>`}
  let renderedPage='';
  // Uma tela que falha mostra um aviso e mantém menu e ⚙ utilizáveis; false permite desfazer uma troca de dados.
  function render(gmailOnly=false){
    if(renderedPage==='agenda'&&view.page!=='agenda')globalThis.FlowCalendar?.showRange?.(null);
    renderedPage=view.page;
    try{paint(gmailOnly);return true}
    catch(error){console.error(error);try{renderFailure('Não foi possível abrir esta tela','Seus dados salvos foram preservados. Exporte uma cópia ou importe um backup em Dados do UlbraFlow.',error)}catch{}return false}
  }
  function paint(gmailOnly){
    cancelPipelineDrag();
    const screen=$('#screen'),scroll=$('.screen'),focused=document.activeElement,focusForm=focused?.closest?.('form[data-email-review]'),focusData=focusForm?{id:focusForm.dataset.emailReview,name:focused.name,start:focused.selectionStart,end:focused.selectionEnd,top:focused.getBoundingClientRect().top}:null;
    const anchor=view.page==='entrada'?[...screen.querySelectorAll('[data-email-card]')].find(card=>card.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top):null,anchorData=anchor?{id:anchor.dataset.emailCard,top:anchor.getBoundingClientRect().top}:null,previousScroll=scroll.scrollTop;
    const names={entrada:'Entrada',esteira:'Esteira',foco:'Foco',tarefas:'Tarefa',projetos:'Áreas',agenda:'Agenda',gmail:'Gmail',alertas:'Alertas',tempo:'Gestão do Tempo','meus-projetos':'Meus projetos','project-editor':'Projeto','project-assessment':'Avaliação Gemini',area:'Área'};
    $('#location-label').textContent=names[view.page];document.title=`UlbraFlow — ${names[view.page]}`;
    document.querySelectorAll('#sidebar-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===view.page));
    const inbox=db.tasks.filter(t=>workflow.stage(db,t)==='inbox').length;
    const count=$('#inbox-count');if(count){count.textContent=inbox;count.hidden=!inbox}
    if(!(gmailOnly&&view.page==='entrada'&&patchGmailReview())){screen.innerHTML=({entrada:renderInbox,esteira:renderPipeline,foco:renderFocus,tarefas:renderTasks,projetos:renderProjects,area:renderArea,'meus-projetos':renderMyProjects,'project-editor':renderProjectEditor,'project-assessment':renderProjectAssessment,agenda:renderCalendar,gmail:renderInbox,alertas:renderAlerts,tempo:renderTime})[view.page]();for(const card of screen.querySelectorAll('[data-email-card],[data-entry-card]'))card._renderedHTML=card.outerHTML;}tick();if(view.page==='entrada'){restoreEmailDrafts();scroll.scrollTop=previousScroll;let target;if(focusData){const form=screen.querySelector(`form[data-email-review="${CSS.escape(focusData.id)}"]`);target=form?.elements.namedItem(focusData.name);if(target){target.focus({preventScroll:true});try{if(focusData.start!==null)target.setSelectionRange(focusData.start,focusData.end);}catch{}scroll.scrollTop+=target.getBoundingClientRect().top-focusData.top;}}if(!target&&anchorData){const card=screen.querySelector(`[data-email-card="${CSS.escape(anchorData.id)}"]`);if(card)scroll.scrollTop+=card.getBoundingClientRect().top-anchorData.top;}}
  }
  function stop(t){if(!t)return;if(db.focus?.taskId===t.id)workflow.pause(db);else workflow.cancel(db,t.id)}
  function start(t){
    if(!t)return;
    if(t.status==='done'){notice('Reabra a tarefa antes de iniciar um ciclo.');return}
    if(!workflow.classified(db,t)){classifyTask(t,()=>start(t));return}
    workflow.start(db,t.id);view.focusId=t.id;persistNow();openPage('foco');notice('Uma tarefa, um ciclo de foco.');
  }
  function complete(t){if(!t)return;workflow.cancel(db,t.id);t.status='done';t.completedAt=Date.now();persistAndRender();notice('Tarefa concluída. Tempo de trabalho preservado.')}
  function moveTask(t,target,options={}){
    if(!t||!Object.hasOwn(nameOfStatus,target)||workflow.stage(db,t)===target)return false;
    if(target==='inbox'){notice('A classificar é para demandas sem área ou prazo. Sua classificação foi preservada.');return false;}
    if(!workflow.classified(db,t)){
      classifyTask(t,()=>{if(!moveTask(findTask(t.id),target,options))render();});
      return false;
    }
    if(target==='done'){complete(t);return true;}
    if(target!=='doing'||options.stopFocus)workflow.cancel(db,t.id);
    t.status=target;t.completedAt=null;persistAndRender();
    notice(options.message||`Demanda movida para ${nameOfStatus[target]}.`);
    return true;
  }
  function chooseTaskStage(id){
    const t=findTask(id);if(!t)return;
    const current=workflow.stage(db,t);
    promptModal({title:'Mover demanda',subtitle:t.title,content:`<label class="field">Para qual etapa?<select name="stage" required><option value="">Escolha uma etapa</option>${Object.entries(nameOfStatus).filter(([key])=>key!=='inbox'&&key!==current).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>`,onSubmit:data=>{
      const target=String(data.get('stage')||'');if(!['todo','doing','waiting','done'].includes(target))return false;
      // Close this chooser first: an unclassified demand needs its own area/date form.
      closeModal();moveTask(findTask(id),target);return false;
    },ok:'Mover'});
  }
  function pipelineStageAt(x,y){
    const board=$('.pipeline-board');if(!board)return null;
    const rect=board.getBoundingClientRect();
    if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return null;
    const direct=document.elementFromPoint(x,y)?.closest('.pipeline-lane');
    if(direct&&board.contains(direct))return direct;
    // Empty lanes are shorter than a long queue; their column still accepts drops.
    return [...board.querySelectorAll('.pipeline-lane')].find(lane=>{const r=lane.getBoundingClientRect();return x>=r.left&&x<=r.right;})||null;
  }
  function highlightPipelineDrop(lane){
    document.querySelectorAll('.pipeline-lane.drag-over,.pipeline-lane.drag-invalid').forEach(node=>{if(node!==lane)node.classList.remove('drag-over','drag-invalid');});
    if(lane){const invalid=lane.dataset.stage==='inbox'&&workflow.classified(db,findTask(pipelineDrag.id));lane.classList.toggle('drag-over',!invalid);lane.classList.toggle('drag-invalid',invalid);}
  }
  function cancelPipelineDrag(){
    const drag=pipelineDrag;pipelineDrag=null;cancelAnimationFrame(dragFrame);dragFrame=0;
    if(drag){drag.preview?.remove();drag.card?.classList.remove('is-dragging');if(drag.handle?.hasPointerCapture?.(drag.pointerId))drag.handle.releasePointerCapture(drag.pointerId);}
    document.body.classList.remove('pipeline-dragging');$('.pipeline-board')?.classList.remove('is-dragging');
    document.querySelectorAll('.pipeline-lane.drag-over,.pipeline-lane.drag-invalid').forEach(node=>node.classList.remove('drag-over','drag-invalid'));
  }
  function pipelineDragFrame(){
    const drag=pipelineDrag;if(!drag?.active)return;
    const board=$('.pipeline-board'),screen=$('.screen');if(!board||!drag.card.isConnected){cancelPipelineDrag();return;}
    const rect=board.getBoundingClientRect(),screenRect=screen.getBoundingClientRect();
    const speed=(point,start,end,size)=>point<start+size?-Math.ceil(14*(1-Math.max(0,point-start)/size)):point>end-size?Math.ceil(14*(1-Math.max(0,end-point)/size)):0;
    if(drag.x>=rect.left&&drag.x<=rect.right&&drag.y>=rect.top&&drag.y<=rect.bottom)board.scrollLeft+=speed(drag.x,rect.left,rect.right,48);
    if(drag.x>=screenRect.left&&drag.x<=screenRect.right&&drag.y>=screenRect.top&&drag.y<=screenRect.bottom)screen.scrollTop+=speed(drag.y,screenRect.top,screenRect.bottom,48);
    if(drag.preview)drag.preview.style.transform=`translate(${drag.x-drag.offsetX}px,${drag.y-drag.offsetY}px)`;
    highlightPipelineDrop(pipelineStageAt(drag.x,drag.y));dragFrame=requestAnimationFrame(pipelineDragFrame);
  }
  function beginPipelineDrag(drag){
    drag.active=true;drag.card.classList.add('is-dragging');document.body.classList.add('pipeline-dragging');$('.pipeline-board')?.classList.add('is-dragging');
    if(drag.mode==='pointer'){
      const rect=drag.card.getBoundingClientRect(),preview=drag.card.cloneNode(true);preview.className='pipeline-task pipeline-drag-preview';preview.removeAttribute('data-pipeline-task');preview.removeAttribute('draggable');preview.setAttribute('aria-hidden','true');preview.inert=true;preview.style.width=rect.width+'px';preview.querySelector('.demand-body')?.remove();document.body.appendChild(preview);drag.preview=preview;
    }
    dragFrame=requestAnimationFrame(pipelineDragFrame);
  }
  document.addEventListener('dragstart',event=>{
    const card=event.target.closest?.('[data-pipeline-task]');if(!card||view.page!=='esteira')return;
    if(event.target.closest('button,input,textarea,select,a')&&!event.target.closest('[data-drag-task]')){event.preventDefault();return;}
    const task=findTask(card.dataset.pipelineTask);if(!task){event.preventDefault();return;}
    cancelPipelineDrag();pipelineDrag={id:task.id,card,mode:'native',x:event.clientX,y:event.clientY};
    event.dataTransfer.setData('application/x-flow-task',task.id);event.dataTransfer.setData('text/plain',task.title);event.dataTransfer.effectAllowed='move';beginPipelineDrag(pipelineDrag);
  });
  document.addEventListener('dragover',event=>{
    if(pipelineDrag?.mode!=='native')return;pipelineDrag.x=event.clientX;pipelineDrag.y=event.clientY;
    const lane=pipelineStageAt(event.clientX,event.clientY);highlightPipelineDrop(lane);if(lane){event.preventDefault();event.dataTransfer.dropEffect='move';}
  });
  document.addEventListener('drop',event=>{
    if(pipelineDrag?.mode!=='native')return;
    const id=pipelineDrag.id,lane=pipelineStageAt(event.clientX,event.clientY),target=lane?.dataset.stage;event.preventDefault();suppressDragClickUntil=Date.now()+400;cancelPipelineDrag();if(target)moveTask(findTask(id),target);
  });
  document.addEventListener('dragend',()=>{if(pipelineDrag?.mode==='native'){suppressDragClickUntil=Date.now()+400;cancelPipelineDrag();}});
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest?.('[data-drag-task]');if(!handle||view.page!=='esteira'||event.pointerType==='mouse'||event.button!==0)return;
    const card=handle.closest('[data-pipeline-task]'),rect=card.getBoundingClientRect();cancelPipelineDrag();
    pipelineDrag={id:handle.dataset.dragTask,mode:'pointer',card,handle,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,active:false};
    try{handle.setPointerCapture(event.pointerId);}catch{}event.preventDefault();
  },{passive:false});
  document.addEventListener('pointermove',event=>{
    const drag=pipelineDrag;if(drag?.mode!=='pointer'||event.pointerId!==drag.pointerId)return;
    drag.x=event.clientX;drag.y=event.clientY;if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>=8)beginPipelineDrag(drag);
    if(drag.active){event.preventDefault();highlightPipelineDrop(pipelineStageAt(drag.x,drag.y));}
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    const drag=pipelineDrag;if(drag?.mode!=='pointer'||event.pointerId!==drag.pointerId)return;
    const target=drag.active?pipelineStageAt(event.clientX,event.clientY)?.dataset.stage:null,id=drag.id;
    if(drag.active){event.preventDefault();suppressDragClickUntil=Date.now()+400;}cancelPipelineDrag();if(target)moveTask(findTask(id),target);
  });
  document.addEventListener('pointercancel',event=>{if(pipelineDrag?.pointerId===event.pointerId)cancelPipelineDrag();});
  document.addEventListener('lostpointercapture',event=>{if(pipelineDrag?.pointerId===event.pointerId)cancelPipelineDrag();});
  window.addEventListener('blur',cancelPipelineDrag);
  document.addEventListener('click',event=>{if(Date.now()<suppressDragClickUntil&&event.target.closest?.('.pipeline-board')){event.preventDefault();event.stopImmediatePropagation();}},true);
  function openPage(page){if(page==='gmail')page='entrada';if(!['entrada','esteira','foco','tarefas','projetos','agenda','gmail','alertas','tempo','area','meus-projetos','project-editor','project-assessment'].includes(page))return;view.page=page;view.aiSuggestion=null;render();document.querySelector('.screen').scrollTo(0,0);if(page==='entrada'&&cloud.gmailToken()&&!FlowGmailReview.info().loading)FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(()=>db,persist))}
  function selectTask(id){if(view.page!=='tarefas')view.detailReturnPage=view.page;view.selectedId=id;view.projectFilter='all';view.statusFilter='all';openPage('tarefas')}
  function openGmail(t){const url=validGmailUrl(t?.gmailUrl);if(!url){notice('Não há um link válido do Gmail nesta tarefa.');return}window.open(url,'_blank','noopener,noreferrer')}
  function download(filename, content, type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportIcs(t){if(!workflow.validDate(t?.plannedDate)){notice('Informe a data de execução antes de exportar o evento.');return}const d=t.plannedDate.replaceAll('-','');let start='',end='';if(/^([01]\d|2[0-3]):[0-5]\d$/.test(t.plannedTime||'')){const dt=new Date(`${t.plannedDate}T${t.plannedTime}:00`);start=`DTSTART:${dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;end=`DTEND:${new Date(dt.getTime()+30*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`}else{const next=new Date(`${t.plannedDate}T12:00:00`);next.setDate(next.getDate()+1);start=`DTSTART;VALUE=DATE:${d}`;end=`DTEND;VALUE=DATE:${localDate(next).replaceAll('-','')}`}const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UlbraFlow Workspace//PT-BR//EN','BEGIN:VEVENT',`UID:${escapeIcs(t.id)}@flow.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,start,end,`SUMMARY:${escapeIcs(t.title)}`,`DESCRIPTION:${escapeIcs(t.description+(t.gmailUrl?'\nGmail: '+t.gmailUrl:''))}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');download(`ulbraflow-${String(t.id).replace(/[^\w-]/g,'')}.ics`,text,'text/calendar;charset=utf-8');notice('Evento .ics exportado. Importe o arquivo no Google Agenda.')}
  // Com a janela aberta o restante do app fica inerte; ao fechar, o foco volta a quem a abriu (ou ao equivalente redesenhado).
  let modalOpener=null;
  const focusableIn=root=>[...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length);
  const openerSelector=node=>{const attributes=[...node.attributes].filter(a=>a.name==='id'||a.name.startsWith('data-'));return attributes.length?node.tagName.toLowerCase()+attributes.map(a=>`[${a.name}="${CSS.escape(a.value)}"]`).join(''):''};
  function promptModal({title,subtitle,content,onSubmit,ok='Salvar'}){
    const box=$('#modal-backdrop');
    if(box.classList.contains('hidden')){const opener=document.activeElement;modalOpener=opener&&opener!==document.body&&!box.contains(opener)?{node:opener,selector:openerSelector(opener)}:null}
    box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${html(title)}"><h2>${html(title)}</h2><p>${html(subtitle)}</p><form id="active-modal-form">${content}<div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">${html(ok)}</button></div></form></div>`;box.classList.remove('hidden');box._submit=onSubmit;$('.app-shell').inert=true;(box.querySelector('input,select')||focusableIn(box)[0])?.focus();
  }
  const closeModal=()=>{
    activeDictation?.abort();activeDictation=null;const box=$('#modal-backdrop'),wasOpen=!box.classList.contains('hidden');box.classList.add('hidden');box.innerHTML='';box._submit=null;$('.app-shell').inert=false;if(!wasOpen)return;
    const opener=modalOpener;modalOpener=null;let target=opener?.node?.isConnected?opener.node:null;try{target||=opener?.selector?document.querySelector(opener.selector):null}catch{}
    if(target&&!target.closest('[inert]')&&target.getClientRects().length)target.focus({preventScroll:true});else{const heading=$('#screen h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}}
  };
  function newProject(){promptModal({title:'Nova área',subtitle:'Organize suas demandas em uma nova área.',content:`<label class="field">Nome da área<input name="name" required maxlength="70" placeholder="Ex.: Planejamento Acadêmico" /></label><label class="field">Cor<select name="color"><option value="#507ee9">Azul</option><option value="#9270d4">Violeta</option><option value="#2ca79a">Verde</option><option value="#dbab56">Dourado</option></select></label>`,onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;db.projects.push({id:uuid(),name,color:String(data.get('color'))});persistAndRender();notice('Área criada.');return true}})}
  function newTask(prefill={}){
    const isMail=!!prefill.gmailUrl, fromAgenda=view.page==='agenda',fromArea=view.page==='area';
    if(fromAgenda&&!prefill.plannedDate){const date=new Date();if(view.weekOffset){date.setDate(date.getDate()-(date.getDay()+6)%7+view.weekOffset*7)}prefill={...prefill,plannedDate:localDate(date)}}
    const content=`<label class="field">O que precisa ser feito?<input name="title" required maxlength="180" value="${html(prefill.title||'')}" placeholder="Ex.: Conferir folha docente" /></label><div class="classification-questions"><label class="field">1. Para onde vai?<select name="project">${projOption(prefill.project||'',false)}</select></label><label class="field">2. Qual o prazo final?<input type="date" name="dueDate" value="${html(prefill.dueDate||'')}" /></label></div><p class="smalltext muted">Se ainda não souber a área ou a data, salve na Entrada e classifique depois.</p><div class="classification-questions"><label class="field">Data de execução<input type="date" name="plannedDate" ${fromAgenda?'required':''} value="${html(prefill.plannedDate||'')}" /></label><label class="field">Hora de execução<input type="time" name="plannedTime" value="${html(prefill.plannedTime||'')}" /></label></div><p class="smalltext muted">A data de execução coloca a demanda na Agenda. Sem horário, aparece como dia inteiro. O prazo final permanece separado.</p><label class="field">Contexto (opcional)<textarea name="description" rows="3" maxlength="7500">${html(prefill.description||'')}</textarea></label><div class="row"><button type="button" class="button" id="task-dictate">🎙 Ditar contexto</button><button type="button" class="button" id="task-rewrite"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Reescrever com Gemini</button></div><p id="task-assist-status" class="smalltext" role="status"></p>${isMail?`<div class="notice" style="margin-top:13px">✉ ${html(prefill.gmailSubject||prefill.gmailUrl)}</div>`:''}`;
    promptModal({title:isMail?'Incluir e-mail no UlbraFlow':'Nova demanda',subtitle:'Capture a demanda. Área e data colocam a tarefa na esteira.',content,onSubmit:data=>{
      const title=String(data.get('title')||'').trim();if(!title||prefill.analyzing)return false;
      const t={id:uuid(),title,project:String(data.get('project')||''),status:'todo',priority:'medium',plannedDate:String(data.get('plannedDate')||''),plannedTime:String(data.get('plannedTime')||''),dueDate:String(data.get('dueDate')||''),description:String(data.get('description')||''),subtasks:[],sessions:[],startedAt:null,focusCycles:0,gmailUrl:validGmailUrl(prefill.gmailUrl||''),gmailSubject:String(prefill.gmailSubject||''),gmailSender:String(prefill.gmailSender||''),createdAt:Date.now(),completedAt:null,initiativeId:prefill.initiativeId||null,source:prefill.shareId?'share':null,sharedUrl:prefill.sharedUrl||null,geminiAnalyzed:!!prefill.geminiReview,geminiClassified:!!prefill.geminiReview?.areaId,geminiModel:prefill.geminiReview?.modelUsed||null};
      if(fromArea&&t.project!==view.areaId){notice('Use a área deste projeto para criar a tarefa.');return false}
      if(t.plannedTime&&!t.plannedDate){notice('Informe a data de execução para usar um horário.');return false}
      db.tasks.unshift(t);view.selectedId=t.id;persistNow();if(prefill.shareId){let saved=false;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY))?.tasks?.some(item=>item.id===t.id);}catch{}if(!saved){db.tasks=db.tasks.filter(item=>item.id!==t.id);return false;}FlowShareTarget.discard(prefill.shareId).catch(()=>{});pendingShare=null}if(fromAgenda){const date=new Date(t.plannedDate+'T12:00:00');const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);view.weekOffset=Math.floor(Math.round((date-monday)/86400000)/7)}openPage(fromArea?'area':fromAgenda?'agenda':workflow.classified(db,t)?'esteira':'entrada');notice(workflow.classified(db,t)?'Demanda incluída na esteira.':'Demanda capturada. Falta classificar área e data.');return true;
    },ok:'Salvar demanda'});
    const form=$('#active-modal-form'),context=form.elements.description,dictate=form.querySelector('#task-dictate'),rewrite=form.querySelector('#task-rewrite'),assistStatus=form.querySelector('#task-assist-status');
    let stopContextDictation;
    dictate.addEventListener('click',()=>{
      if(stopContextDictation){stopContextDictation();return;}
      if(activeDictation){activeDictation.stop();return;}
      const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Recognition){assistStatus.textContent='Use o microfone do teclado para ditar neste campo.';context.focus();return;}
      const speech=new Recognition(),segments=new Map();let failed=false,ended=false,timeout,received=false;
      activeDictation=speech;speech.lang='pt-BR';speech.continuous=false;speech.interimResults=true;
      const append=text=>{if(!text.trim()||!form.isConnected)return;context.value=(context.value.trimEnd()+' '+text.trim()).trim().slice(0,7500);};
      const finish=()=>{if(ended)return;ended=true;clearTimeout(timeout);stopContextDictation=null;if(activeDictation===speech)activeDictation=null;if(form.isConnected){dictate.textContent='🎙 Ditar contexto';rewrite.disabled=false;if(!failed)assistStatus.textContent=received?'Ditado concluído. Revise o texto.':'Nenhuma fala reconhecida. Use o microfone do teclado ou tente novamente.';}};
      stopContextDictation=()=>{for(const segment of segments.values())if(!segment.saved){append(segment.text);segment.saved=true;}finish();try{speech.abort();}catch{}};
      speech.onresult=event=>{
        if(ended||!form.isConnected)return;received=true;
        for(let i=event.resultIndex||0;i<event.results.length;i++){
          const result=event.results[i],old=segments.get(i);if(old?.saved)continue;
          const segment={text:result[0].transcript,saved:false};segments.set(i,segment);
          if(result.isFinal){append(segment.text);segment.saved=true;}
        }
        const pending=[...segments.values()].filter(segment=>!segment.saved).map(segment=>segment.text).join(' ');
        assistStatus.textContent=pending?'Ouvindo: '+pending:'Ouvindo…';
      };
      speech.onerror=event=>{failed=true;if(form.isConnected)assistStatus.textContent=event.error==='not-allowed'?'Permita o microfone ou use o microfone do teclado.':'O reconhecimento de voz falhou. Use o microfone do teclado neste campo.';finish();};
      speech.onend=()=>{if(!ended)for(const segment of segments.values())if(!segment.saved){append(segment.text);segment.saved=true;}finish();};
      dictate.textContent='■ Parar ditado';rewrite.disabled=true;assistStatus.textContent='Ouvindo…';
      timeout=setTimeout(()=>{if(!received){failed=true;assistStatus.textContent='O ditado está demorando. Use o microfone do teclado neste campo.';}stopContextDictation?.();},15000);
      try{speech.start();}catch{failed=true;assistStatus.textContent='Use o microfone do teclado para ditar neste campo.';finish();}
    });
    rewrite.addEventListener('click',async()=>{
      const text=context.value.trim();if(!text){assistStatus.textContent='Escreva ou dite o contexto primeiro.';return;}if(prefill.analyzing)return;
      prefill.analyzing=true;rewrite.disabled=true;dictate.disabled=true;context.disabled=true;const save=form.querySelector('[type="submit"]');save.disabled=true;assistStatus.textContent='Gemini está reescrevendo o contexto…';
      try{const result=await cloud.analyzeGmail({mode:'rewrite',subject:form.elements.title.value.slice(0,300),text,areas:[]});if(form.isConnected){if(typeof result.reply!=='string'||!result.reply.trim())throw new Error('O Gemini não retornou um texto. Tente novamente.');context.value=result.reply.slice(0,7500);assistStatus.textContent='Texto reescrito. Revise antes de salvar.';}}
      catch(error){if(form.isConnected)assistStatus.textContent=error.message;}
      finally{prefill.analyzing=false;if(form.isConnected){rewrite.disabled=false;dictate.disabled=false;context.disabled=false;save.disabled=false;}}
    });
    if(prefill.shareId){const form=$('#active-modal-form'),row=document.createElement('div');row.className='share-assist';row.innerHTML='<button type="button" class="button"><img src="./assets/gemini.svg" alt="" width="16" height="16"> Sugerir classificação com Gemini</button><p class="smalltext" role="status"></p>';form.insertBefore(row,form.querySelector('.modal-footer'));const button=row.querySelector('button'),status=row.querySelector('p');button.addEventListener('click',async()=>{if(prefill.analyzing)return;prefill.analyzing=true;button.disabled=true;const save=form.querySelector('[type="submit"]');save.disabled=true;const snapshot={title:form.elements.title.value,project:form.elements.project.value,dueDate:form.elements.dueDate.value};status.textContent='Analisando o texto compartilhado…';try{const result=await cloud.analyzeGmail({subject:snapshot.title,text:form.elements.description.value,areas:db.projects.map(p=>({id:p.id,name:p.name}))});if(form.isConnected){prefill.geminiReview=result;for(const [field,value] of Object.entries({title:result.title,project:result.areaId,dueDate:workflow.validDate(result.dueDate)?result.dueDate:''})){if(value&&form.elements[field].value===snapshot[field])form.elements[field].value=value;}status.textContent=result.summary+' Confira a área e o prazo antes de salvar.';}}catch(error){if(form.isConnected)status.textContent=error.message;}finally{prefill.analyzing=false;if(form.isConnected){button.disabled=false;save.disabled=false;}}});}
  }
  function classifyTask(t,after){
    if(!t)return;
    promptModal({title:'Classificar demanda',subtitle:t.title,content:`<div class="classification-questions"><label class="field">1. Para onde vai?<select name="project" required>${projOption(t.project||'',false)}</select></label><label class="field">2. Qual o prazo final?<input type="date" name="dueDate" required value="${html(t.dueDate||'')}" /></label></div><p class="smalltext muted">A área identifica a demanda. A data determina sua urgência na esteira comum.</p>`,onSubmit:data=>{
      const project=String(data.get('project')||''),dueDate=String(data.get('dueDate')||'');
      if(!db.projects.some(area=>area.id===project)||!workflow.validDate(dueDate))return false;
      t.project=project;t.dueDate=dueDate;if(t.status==='inbox')t.status='todo';persistNow();
      if(after)after();else openPage('esteira');notice('Demanda classificada.');return true;
    },ok:'Incluir na esteira'});
  }
  function linkMail(){promptModal({title:'Vincular conversa do Gmail',subtitle:'Cole o link da conversa e associe a uma nova tarefa.',content:`<label class="field">Link da conversa<input name="url" type="url" required placeholder="https://mail.google.com/mail/u/0/#..." /></label><label class="field">Assunto<input name="subject" required maxlength="180" placeholder="Assunto do e-mail" /></label><label class="field">Remetente (opcional)<input name="sender" maxlength="150" placeholder="Setor responsável" /></label>`,onSubmit:data=>{const gmailUrl=validGmailUrl(String(data.get('url')));if(!gmailUrl){notice('Cole um endereço HTTPS válido de mail.google.com.');return false}const gmailSubject=String(data.get('subject')||'').trim();const gmailSender=String(data.get('sender')||'').trim();newTask({title:`Responder: ${gmailSubject}`,gmailUrl,gmailSubject,gmailSender});return false},ok:'Continuar'})}
  // Em recuperação, o backup exportado é o conteúdo original preservado, não o workspace vazio exibido.
  function exportData(){flushPersist();const text=recovering?(workspace.mode==='cloud'?JSON.stringify(workspace.data??null,null,2):localStorage.getItem(STORAGE_KEY)||''):JSON.stringify(db,null,2);download(`ulbraflow-backup-${localDate()}.json`,text,'application/json');notice('Cópia de segurança exportada.')}
  // Troca o workspace só se a nova versão normaliza e é exibida; senão a anterior continua intacta e nada é salvo.
  // Uma troca aceita descarta a gravação pendente desta aba: o conteúdo recebido é mais novo.
  function replaceWorkspace(data,validate=false){
    let next,changed;try{next=normalizeWorkspace(data);changed=workflow.reconcile(next)}catch(error){console.error(error);return false}
    const previous=db,previousView=view,wasDirty=persistDirty,undo=()=>{db=previous;view=previousView;render();if(wasDirty)persist();return false};
    db=next;view={...previousView};clearTimeout(persistTimer);persistDirty=false;
    if(validate){try{for(const page of [renderInbox,renderPipeline,renderFocus,renderTasks,renderProjects,renderArea,renderMyProjects,renderAlerts,renderTime])page();view={...previousView}}catch(error){console.error(error);return undo()}}
    if(!render())return undo();
    if(changed)persist();return true;
  }
  function importData(){
    flushPersist();promptModal({title:'Importar backup',subtitle:'Atenção: esta operação substitui as tarefas e áreas do workspace atual.',content:`<label class="field">Arquivo JSON do UlbraFlow<input name="file" type="file" accept=".json,application/json" required /></label>`,onSubmit:()=>false,ok:'Importar'});
    const form=$('#active-modal-form');let busy=false;
    form.addEventListener('submit',async e=>{
      e.preventDefault();const file=form.elements.file.files?.[0];if(!file||busy)return;busy=true;
      try{
        let value=null;try{value=JSON.parse(await file.text())}catch{}
        if(!validBackup(value)){notice('Backup inválido ou incompatível. O workspace atual foi mantido.');return}
        if(!confirm('Substituir todas as tarefas e áreas atuais pelo backup?'))return;
        if(!replaceWorkspace(value,true)){notice('Este backup não pôde ser aberto. O workspace atual foi mantido sem alterações.');return}
        recovering=false;projectDraft=null;if(view.page==='project-editor')view.page='meus-projetos';view.selectedId=db.tasks[0]?.id||null;
        persistNow();closeModal();render();notice('Backup importado com sucesso.');
      }finally{busy=false}
    });
  }
  function settingsModal(){promptModal({title:'Dados do UlbraFlow',subtitle:workspace.mode==='cloud'?'Dados privados da sua conta Google, salvos no Supabase.':'Seus dados estão salvos neste navegador.',content:`<div class="notice">Exporte uma cópia das suas tarefas e dos históricos de tempo. ${workspace.mode==='cloud'?'Confira o estado do salvamento no botão da conta.':'O acesso Google permite ativar o armazenamento na nuvem.'}</div><div class="row" style="margin-top:15px;flex-wrap:wrap"><button type="button" class="button" data-action="export-data">↓ Exportar backup</button><button type="button" class="button" data-action="import-data">↑ Importar backup</button>${workspace.mode==='cloud'?button('Trazer tarefas deste navegador','import-local'):button('Entrar com Google','account')}</div>`,onSubmit:()=>true,ok:'Fechar'})}

  async function generateAI(){
    const t=selectedTask();if(!t||view.aiLoading)return;const mode=view.aiMode;
    const input=$('#edit-description');if(input)t.description=input.value;
    if(!t.description.trim()){notice('Escreva uma descrição antes de chamar o Gemini.');return}
    if(!accessToken){const value=prompt('Informe a senha de acesso ao assistente UlbraFlow (não é a chave Gemini). Ela será mantida apenas nesta aba.');if(value===null)return;accessToken=value.trim()}
    view.aiLoading=true;render();
    try{
      const result=await fetch('/api/gemini',{method:'POST',headers:{'content-type':'application/json','x-flow-access-token':accessToken},body:JSON.stringify({mode,title:t.title,description:t.description}),signal:AbortSignal.timeout(45000)});
      const payload=await result.json().catch(()=>({}));
      if(!result.ok)throw new Error(payload.error||'Não foi possível consultar o Gemini.');
      if(!findTask(t.id)||view.page!=='tarefas'||view.selectedId!==t.id)return;
      view.aiSuggestion={taskId:t.id,mode,text:payload.text};notice('Sugestão recebida. Revise o conteúdo antes de aplicar.');
    }catch(err){if(String(err.message).includes('Senha'))accessToken='';notice(err.message||'Erro ao chamar o Gemini. Verifique a configuração no servidor.')}finally{view.aiLoading=false;persistAndRender()}
  }
  function applyAI(){const t=selectedTask();if(!t||!view.aiSuggestion||view.aiSuggestion.taskId!==t.id)return;const text=$('#ai-output')?.value||view.aiSuggestion.text;if(view.aiSuggestion.mode==='subtasks'){const lines=text.split('\n').map(s=>s.replace(/^[-*•\d.)\s]+/,'').trim()).filter(Boolean).slice(0,6);lines.forEach(line=>t.subtasks.push({id:uuid(),text:line.slice(0,180),done:false}));notice(`${lines.length} subtarefas adicionadas.`)}else{t.description=text;notice('Sugestão aplicada à descrição.')}view.aiSuggestion=null;persistAndRender()}
  function handleCapture(){
    if(!location.hash.startsWith('#capture='))return;
    let payload={};try{payload=JSON.parse(decodeURIComponent(location.hash.slice(9)))}catch{history.replaceState(null,'',location.pathname+location.search);notice('Dados da extensão inválidos.');return}
    history.replaceState(null,'',location.pathname+location.search);
    const gmailUrl=validGmailUrl(payload.gmailUrl||'');if(!gmailUrl){notice('Captura recusada: link não pertence ao Gmail.');return}
    newTask({title:`Responder: ${String(payload.gmailSubject||'E-mail').slice(0,160)}`,gmailUrl,gmailSubject:String(payload.gmailSubject||'').slice(0,180),gmailSender:String(payload.gmailSender||'').slice(0,150)});
  }
  document.addEventListener('toggle',e=>{const details=e.target;if(details.matches?.('.demand-accordion')){if(details.open){expandedDemands.add(details.dataset.demand);const task=findTask(details.dataset.demand);if(task&&!details.querySelector('.demand-body'))details.insertAdjacentHTML('beforeend',renderPipelineBody(task,workflow.stage(db,task)));}else expandedDemands.delete(details.dataset.demand)}},true);
  document.addEventListener('click',async e=>{
    const element=e.target.closest('button');if(!element)return;
    if(element.closest('#project-template-menu')&&matchMedia('(max-width:760px)').matches)$('.project-nav-menu').open=false;
    if(element.dataset.assessmentImprove){await improveAssessmentField(element.dataset.assessmentImprove);return;}
    if(element.dataset.useRecommendation){if(!projectModels[element.dataset.useRecommendation])return;modelProject(element.dataset.useRecommendation);Object.assign(projectDraft,{description:projectAssessment.problem,owner:projectAssessment.people.slice(0,150),resources:projectAssessment.constraints,startDate:projectAssessment.startDate,endDate:projectAssessment.endDate,areaId:projectAssessment.areaId});render();await generateProjectPlan();return;}
    if(element.dataset.projectImprove){await improveProjectField(element.dataset.projectImprove);return;}
    if(element.dataset.projectModel){modelProject(element.dataset.projectModel);return;}
    if(element.dataset.dragTask){chooseTaskStage(element.dataset.dragTask);return;}
    const areaId=element.dataset.areaUp||element.dataset.areaDown;
    if(areaId){const index=db.projects.findIndex(p=>p.id===areaId),target=index+(element.dataset.areaUp?-1:1);if(index>=0&&target>=0&&target<db.projects.length){[db.projects[index],db.projects[target]]=[db.projects[target],db.projects[index]];persistAndRender();document.querySelector(`[data-area-${element.dataset.areaUp?'up':'down'}="${CSS.escape(areaId)}"]`)?.focus()}return}
    if(element.dataset.ignoreEmail){const email=FlowGmailReview.info().emails.find(e=>e.id===element.dataset.ignoreEmail);if(email){db.gmailReviews??={};db.gmailReviews[email.id]={messageId:email.messageId,state:'ignored',at:Date.now()};persistAndRender()}return}
    if(element.dataset.replyEmail){await composeReply(element.dataset.replyEmail);return}
    const page=element.dataset.page;
    if(page){openPage(page);return}
    if(element.dataset.timePeriod){view.timePeriod=element.dataset.timePeriod;view.timeOffset=0;render();return}
    if(element.dataset.openEmail){openGmail(findTask(element.dataset.openEmail));return}
    const id=element.dataset.task;if(id){selectTask(id);return}
    const p=element.dataset.project;if(p){view.areaId=p;openPage('area');return}
    const mailId=element.dataset.mailTask;if(mailId){view.mailSelected=mailId;render();return}
    const subid=element.dataset.deleteSub;if(subid){const t=selectedTask();t.subtasks=t.subtasks.filter(s=>s.id!==subid);persistAndRender();return}
    if(element.dataset.alert!==undefined){const i=Number(element.dataset.alert);db.preferences.alerts[i]=db.preferences.alerts[i]!==true;persistAndRender();return}
    const t=selectedTask();try{switch(element.dataset.action){
      case 'toggle-done':view.hideDone=!view.hideDone;render();break;
      case 'show-areas':openPage('projetos');break;
      case 'project-generate':await generateProjectPlan();break;
      case 'project-apply-plan':{
        const d=projectDraft,p=d?.suggestion;if(!p||d.busy)break;d.name=p.name;d.description=p.description;d.drafts[d.model]=Object.fromEntries(p.sections.map(section=>[section.id,section.text]));d.milestones=p.milestones.map(m=>({id:uuid(),name:m.name,dueDate:workflow.validDate(m.dueDate)?m.dueDate:'',owner:'',done:false}));d.risks=p.risks.map(r=>({id:uuid(),title:r.title,mitigation:r.mitigation,severity:'medium',status:'open'}));d.suggestion=null;render();$('#project-model-status').textContent='Proposta aplicada ao rascunho. Revise os campos e salve o projeto.';break;
      }
      case 'project-discard-plan':if(projectDraft){projectDraft.suggestion=null;render();}break;
      case 'project-add-row':{
        const d=projectDraft,collection=element.dataset.collection;if(!d||d.busy||!['milestones','risks','indicators'].includes(collection))break;
        if(d[collection].length>=30){notice('Use até 30 itens por seção.');break;}
        d[collection].push(collection==='milestones'?{id:uuid(),name:'',owner:'',dueDate:'',done:false}:collection==='risks'?{id:uuid(),title:'',mitigation:'',severity:'medium',status:'open'}:{id:uuid(),name:'',unit:'',baseline:'',target:'',current:''});render();break;
      }
      case 'project-remove-row':{const d=projectDraft,collection=element.dataset.collection;if(d&&!d.busy&&['milestones','risks','indicators'].includes(collection)){d[collection]=d[collection].filter(row=>row.id!==element.dataset.id);render();}break;}
      case 'project-editor-task':{const d=projectDraft;if(!d?.id){notice('Salve o projeto antes de adicionar tarefas.');break;}newTask({project:d.areaId,initiativeId:d.id});break;}
      case 'project-milestone-task':{const d=projectDraft,m=d?.milestones.find(m=>m.id===element.dataset.id);if(!d?.id){notice('Salve o projeto antes de criar tarefas das entregas.');break;}if(m?.name.trim())newTask({title:m.name,project:d.areaId,initiativeId:d.id,dueDate:m.dueDate,description:m.owner?'Responsável: '+m.owner:''});else notice('Informe o nome da entrega.');break;}
      case 'project-link-task':{const d=projectDraft,t=findTask($('#project-link-task')?.value);if(!d?.id){notice('Salve o projeto antes de vincular tarefas.');break;}if(t&&t.project===d.areaId&&!t.initiativeId){t.initiativeId=d.id;persistAndRender();notice('Tarefa vinculada ao projeto.');}break;}
      case 'project-export':exportProjectReport();break;
      case 'project-editor-back':openPage('meus-projetos');break;
      case 'create-model-project':modelProject();break;
      case 'edit-model-project':{const project=db.initiatives.find(p=>p.id===element.dataset.id);if(project)modelProject(project.model||'simple',project);break;}
      case 'delete-initiative':{const project=db.initiatives.find(p=>p.id===element.dataset.id);if(project)requestProjectDeletion(project);break;}
      case 'restore-initiative':{
        const entry=db.projectTrash?.find(entry=>entry.project.id===element.dataset.id);if(!entry)break;
        if(findProject(entry.project.areaId))restoreProject(entry);
        else promptModal({title:'Restaurar projeto',subtitle:'Escolha uma área disponível para restaurar este projeto.',content:`<label class="field">Área<select name="areaId" required>${projOption('',false)}</select></label>`,ok:'Restaurar',onSubmit:data=>{const areaId=String(data.get('areaId')||'');if(!findProject(areaId))return false;restoreProject(entry,areaId);return true;}});
        break;
      }
      case 'project-library-task':{const project=db.initiatives.find(p=>p.id===element.dataset.id);if(project)newTask({project:project.areaId,initiativeId:project.id});break;}
      case 'new-initiative':newInitiative();break;
      case 'rename-initiative':{
        const project=(db.initiatives||[]).find(p=>p.id===element.dataset.id&&p.areaId===view.areaId);if(!project)break;
        promptModal({title:'Renomear projeto',subtitle:'Atualize o nome do projeto.',content:`<label class="field">Nome do projeto<input name="name" required maxlength="100" value="${html(project.name)}"></label>`,onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;project.name=name.slice(0,100);persistAndRender();return true},ok:'Salvar nome'});break;
      }
      case 'area-new-task':newTask({project:view.areaId});break;
      case 'initiative-new-task':{const initiative=(db.initiatives||[]).find(p=>p.id===element.dataset.id&&p.areaId===view.areaId);if(initiative)newTask({project:view.areaId,initiativeId:initiative.id});break}
      case 'review-share':if(pendingShare)newTask({title:pendingShare.title||'Mensagem compartilhada',description:[pendingShare.text,pendingShare.url].filter(Boolean).join('\n\n').slice(0,7500),shareId:pendingShare.id,sharedUrl:pendingShare.url});break;
      case 'discard-share':if(pendingShare){await FlowShareTarget.discard(pendingShare.id);pendingShare=null;render()}break;
      case 'new-task':newTask();break;
      case 'gmail-read-connect':flushPersist();try{await cloud.signIn('gmail')}catch(error){notice(error.message)}break;
      case 'gmail-refresh':await FlowGmailReview.refresh();await FlowGmailReview.analyze(()=>db,persist);break;
      case 'gmail-more':await FlowGmailReview.refresh(true);await FlowGmailReview.analyze(()=>db,persist);break;
      case 'gmail-analyze':await FlowGmailReview.analyze(()=>db,persist,true);break;
      case 'gmail-read-disconnect':cloud.disconnectGmail();FlowGmailReview.reset();render();break;
      case 'gmail-mobile':
        try{const token=await cloud.createGmailToken();promptModal({title:'Gmail no celular',subtitle:'Cole esta chave no complemento Incluir no UlbraFlow. Ela vale por 90 dias e substitui a conexão anterior.',content:`<label class="field">Chave de conexão<input readonly value="${html(token)}" autocomplete="off" spellcheck="false" aria-label="Chave de conexão Gmail" /></label><p class="smalltext">Guarde esta chave apenas no complemento. Ela permite consultar áreas e incluir demandas na sua conta.</p>`,onSubmit:()=>true,ok:'Fechar'})}catch(error){notice(error.message)}break;
      case 'gmail-mobile-revoke':try{await cloud.revokeGmailToken();notice('Conexão do Gmail no celular revogada.')}catch(error){notice(error.message)}break;
      case 'new-project':newProject();break;
      case 'close-modal':closeModal();break;
      case 'open-active':openPage('foco');break;
      case 'show-pipeline':openPage('esteira');break;
      case 'show-inbox':openPage('entrada');break;
      case 'classify-task':classifyTask(findTask(element.dataset.id)||t);break;
      case 'return-task':{const task=findTask(element.dataset.id);if(!task)break;const previous={doing:'todo',waiting:'doing',done:'waiting'}[workflow.stage(db,task)];if(previous)moveTask(task,previous,{stopFocus:true,message:'Demanda retornou uma etapa.'});break;}
      case 'advance-task':{const task=findTask(element.dataset.id);if(!task)break;const stage=workflow.stage(db,task);if(stage==='inbox'){classifyTask(task);break;}const target={todo:'doing',doing:'waiting',waiting:'done'}[stage];if(target)moveTask(task,target);break;}
      case 'focus-task':start(findTask(element.dataset.id));break;
      case 'focus-start':start(focusTask());break;
      case 'focus-pause':workflow.pause(db);persistAndRender();break;
      case 'break-resume':workflow.resumeBreak(db);persistAndRender();break;
      case 'focus-change':if(db.focus)workflow.cancel(db,db.focus.taskId);view.focusId=null;persistAndRender();break;
      case 'focus-complete':complete(focusTask());break;
      case 'start':start(t);break;
      case 'pause':stop(t);persistAndRender();notice('Cronômetro pausado.');break;
      case 'complete':complete(t);break;
      case 'delete-task':if(confirm('Excluir a tarefa e todo seu histórico de tempo?')){workflow.cancel(db,t.id);db.tasks=db.tasks.filter(x=>x.id!==t.id);view.selectedId=null;persistNow();openPage(view.detailReturnPage||'esteira');notice('Tarefa excluída.')}break;
      case 'reply-task':if(t?.gmailThreadId)await composeReply(t.gmailThreadId);break;
      case 'open-email':openGmail(t);break;
      case 'open-linked-email':openGmail(findTask(view.mailSelected));break;
      case 'open-mail-task':selectTask(view.mailSelected);break;
      case 'export-ics':exportIcs(t);break;
      case 'calendar-connect':flushPersist();await globalThis.FlowCalendar.connect();break;
      case 'calendar-sync':await globalThis.FlowCalendar.synchronize();break;
      case 'calendar-disconnect':globalThis.FlowCalendar.disconnect();render();notice('Conexão encerrada. Os eventos já criados permanecem no Google Agenda.');break;
      case 'account':accountModal();break;
      case 'sign-out':flushPersist();await cloud.signOut();break;
      case 'cloud-retry':flushPersist();await cloud.flush(db);closeModal();notice('Dados salvos na nuvem.');break;
      case 'cloud-reload':if(confirm('Carregar os dados da nuvem? A cópia atual será preservada como backup neste navegador.')){flushPersist();reloading=true;try{await cloud.loadRemote()}catch(error){reloading=false;throw error}}break;
      case 'import-local':importLocal();break;
      case 'time-previous':view.timeOffset--;render();break;
      case 'time-next':view.timeOffset++;render();break;
      case 'time-current':view.timeOffset=0;render();break;
      case 'time-report':reportModal();break;
      case 'time-csv':download(`ulbraflow-tempo-${view.timePeriod}-${localDate(timeReport().start)}.csv`,globalThis.FlowTime.csv(timeReport()),'text/csv;charset=utf-8');notice('Relatório CSV gerado.');break;
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
    if(existing){existing.geminiAnalyzed=!!review;existing.geminiClassified=!!review?.areaId;existing.geminiModel=review?.modelUsed||null;existing.title=title;existing.gmailSubject=email.subject;existing.gmailSender=email.sender;existing.project=project;existing.dueDate=dueDate;existing.gmailMessageId=email.messageId;existing.gmailThreadId=email.id;}
    else db.tasks.unshift({id:uuid(),title,project,dueDate,status:'todo',priority:'medium',plannedDate:'',plannedTime:'',description:review?.summary||email.snippet,subtasks:[],sessions:[],startedAt:null,focusCycles:0,completedAt:null,createdAt:Date.now(),gmailUrl:email.gmailUrl,gmailSubject:email.subject,gmailSender:email.sender,gmailCaptureId:'gmail-review-'+email.id,gmailThreadId:email.id,gmailMessageId:email.messageId,geminiAnalyzed:!!review,geminiClassified:!!review?.areaId,geminiModel:review?.modelUsed||null});
    db.gmailReviews??={};const previousReview=db.gmailReviews[email.id];db.gmailReviews[email.id]={...(review||{}),messageId:email.messageId,state:'accepted',at:Date.now()};persistAndRender();let confirmed=false;try{await cloud.flush(db);confirmed=true;if(shouldArchive)await FlowGmailReview.archive(email.id,email.messageId);notice(shouldArchive?'Demanda salva e e-mail arquivado.':existing?'Demanda atualizada.':'Demanda incluída na esteira.')}catch(error){if(!confirmed){if(previousReview)db.gmailReviews[email.id]=previousReview;else delete db.gmailReviews[email.id];persistAndRender();notice('A nuvem não confirmou o salvamento. O e-mail não foi arquivado: '+error.message)}else notice('Demanda salva, mas o Gmail não foi arquivado: '+error.message)}
  });
  document.addEventListener('change',e=>{
    const x=e.target,t=selectedTask();
    if(x.dataset.senderColor){db.gmailSenderColors??={};db.gmailSenderColors[x.dataset.senderColor]=x.value;persistAndRender();return}
    if(x.dataset.completeTask){if(x.checked)complete(findTask(x.dataset.completeTask));return;}
    if(x.dataset.moveTask){moveTask(findTask(x.dataset.moveTask),x.value);return;}
    if(x.dataset.focusSub){const sub=focusTask()?.subtasks.find(s=>s.id===x.dataset.focusSub);if(sub){sub.done=x.checked;persistAndRender()}return}
    if(x.dataset.sub){const sub=t.subtasks.find(s=>s.id===x.dataset.sub);if(sub){sub.done=x.checked;persistAndRender()}return}
    if(x.id==='filter-project'){view.projectFilter=x.value;render();return}
    if(x.id==='filter-status'){view.statusFilter=x.value;render();return}
    if(x.id==='board-date-filter'){view.boardDate=x.value;render();return}
    if(x.id==='board-specific-date'){view.boardSpecificDate=x.value;render();return}
    if(x.id==='board-filter'){view.projectBoard=x.value;render();return}
    if(x.id==='focus-task-select'){view.focusId=x.value;render();return}
    if(x.id==='focus-minutes'||x.id==='break-minutes'){const n=Number(x.value),max=x.id==='focus-minutes'?180:60;if(!Number.isInteger(n)||n<1||n>max){notice(`Escolha entre 1 e ${max} minutos.`);render();return}db.preferences[x.id==='focus-minutes'?'focusMinutes':'breakMinutes']=n;persistAndRender();return}
    if(x.id==='ai-mode'){view.aiMode=x.value;view.aiSuggestion=null;render();return}
    if(x.id==='reminder-days'){db.preferences.reminderDays=[1,2,3,7].includes(Number(x.value))?Number(x.value):1;persistNow();return}
    const fieldMap={'edit-title':'title','edit-project':'project','edit-status':'status','edit-planned':'plannedDate','edit-time':'plannedTime','edit-due':'dueDate','edit-description':'description'};
    if(fieldMap[x.id] && t){const field=fieldMap[x.id];if(field==='status'&&x.value==='done'){workflow.cancel(db,t.id);t.completedAt=Date.now()}if(field==='status'&&t.status==='done'&&x.value!=='done')t.completedAt=null;t[field]=x.value;if((field==='project'||field==='dueDate')&&!workflow.classified(db,t))workflow.cancel(db,t.id);if(field==='status'&&x.value!=='doing')workflow.cancel(db,t.id);persistAndRender()}
  });
  document.addEventListener('input',e=>{if(e.target.id==='edit-description'){const t=selectedTask();if(t){t.description=e.target.value;persist()}}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(pipelineDrag?.active)suppressDragClickUntil=Date.now()+400;cancelPipelineDrag();closeModal();return}
    // Tab e Shift+Tab circulam apenas dentro da janela aberta.
    const box=$('#modal-backdrop');if(e.key!=='Tab'||box.classList.contains('hidden'))return;
    const items=focusableIn(box),inside=box.contains(document.activeElement);if(!items.length){e.preventDefault();return}
    if(!inside||document.activeElement===(e.shiftKey?items[0]:items.at(-1))){e.preventDefault();(e.shiftKey?items.at(-1):items[0]).focus()}
  });
  // Mantém o texto em edição, o foco e a rolagem quando outra aba ou a nuvem substituem o workspace.
  function captureEditing(){const field=document.activeElement,state={top:$('.screen').scrollTop,page:view.page};if(field?.id&&$('#screen').contains(field))Object.assign(state,{id:field.id,value:field.value,start:field.selectionStart,end:field.selectionEnd,taskId:field.id==='edit-description'?selectedTask()?.id:null});return state}
  function restoreEditing(state){
    if(view.page!==state.page)return;if(view.page!=='entrada')$('.screen').scrollTop=state.top;
    const field=state.id&&document.getElementById(state.id);if(!field)return;
    if(state.taskId){const t=selectedTask();if(t?.id!==state.taskId)return;if(t.description!==state.value){t.description=state.value;persist()}field.value=state.value}
    field.focus({preventScroll:true});try{if(state.start!=null)field.setSelectionRange(state.start,state.end)}catch{}
  }
  const storedWorkspace=()=>{try{return readStored()}catch{return null}};
  window.addEventListener('storage',e=>{if(e.key!==STORAGE_KEY)return;const next=storedWorkspace();if(!next)return;const editing=captureEditing();if(replaceWorkspace(next)){recovering=false;restoreEditing(editing)}});
  // Pedido da extensão no Gmail (Concluir e voltar ao UlbraFlow): mesma regra do botão Concluir e a tarefa fica aberta na tela.
  window.addEventListener('flow:complete-task',event=>{const {requestId,taskId}=event.detail||{},reply=detail=>window.dispatchEvent(new CustomEvent('flow:complete-task-result',{detail:{requestId,...detail}}));try{const task=typeof taskId==='string'?db.tasks.find(t=>t.id===taskId):null;if(!task){reply({ok:false,error:'A tarefa não está neste UlbraFlow. Atualize a aba do UlbraFlow e tente novamente.'});return}if(task.status!=='done')complete(task);view.projectBoard='all';view.boardDate='all';selectTask(task.id);reply({ok:true,taskId:task.id})}catch(error){reply({ok:false,error:error.message||'Não foi possível concluir a tarefa.'})}});
  window.addEventListener('flow:open-capture',event=>{const next=storedWorkspace();if(next)replaceWorkspace(next);const {requestId,taskId}=event.detail||{},task=db.tasks.find(t=>(requestId&&t.gmailCaptureId===requestId)||(taskId&&t.id===taskId));if(task){view.projectBoard='all';view.boardDate='all';openPage('esteira');selectTask(task.id)}});
  // cloud.js já enfileirou a versão mesclada após um conflito: aqui só a cópia local é atualizada.
  window.addEventListener('flow:cloud-remote-merged',event=>{
    const data=event.detail?.data;if(workspace.mode!=='cloud'||recovering||!record(data))return;
    const editing=captureEditing();let copy;try{copy=structuredClone(data)}catch{return}
    if(!replaceWorkspace(copy)){notice('A versão mesclada da nuvem não pôde ser exibida. Recarregue o UlbraFlow.');return}
    try{writeLocal(JSON.stringify(db))}catch{}restoreEditing(editing);
  });
  // Grava na hora ao sair, ao perder o foco e quando a extensão vai ler o armazenamento.
  for(const type of ['flow:persist-flush','pagehide','beforeunload','blur'])window.addEventListener(type,()=>flushPersist());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushPersist()});
  function rememberEmailDraft(event){const x=event.target,form=x.closest?.('form[data-email-review]');if(!form||!x.name)return;const email=FlowGmailReview.info().emails.find(e=>e.id===form.dataset.emailReview);if(!email)return;view.emailDrafts??={};let draft=view.emailDrafts[email.id];if(draft?.messageId!==email.messageId)draft=view.emailDrafts[email.id]={messageId:email.messageId,fields:{}};draft.fields[x.name]=x.type==='checkbox'?x.checked:x.value;}
  document.addEventListener('input',rememberEmailDraft);document.addEventListener('change',rememberEmailDraft);
  function restoreEmailDrafts(){for(const email of FlowGmailReview.info().emails){const draft=view.emailDrafts?.[email.id];if(draft?.messageId!==email.messageId)continue;const form=document.querySelector(`form[data-email-review="${CSS.escape(email.id)}"]`);if(form)for(const [name,value] of Object.entries(draft.fields)){const input=form.elements.namedItem(name);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value}}}}
  let gmailPaint;
  window.addEventListener('flow:gmail-review',event=>{
    if(view.page==='entrada'&&!gmailPaint)gmailPaint=requestAnimationFrame(()=>{gmailPaint=null;if(view.page==='entrada')render(true)});
    if(event.detail?.emailsChanged)FlowGmailReview.analyze(()=>db,persist);
  });
  setInterval(()=>{if(view.page==='entrada'&&!document.hidden&&cloud.gmailToken()&&!FlowGmailReview.info().loading)FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(()=>db,persist))},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&view.page==='entrada'&&cloud.gmailToken())FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(()=>db,persist))});
  window.addEventListener('flow:sync-status',updateAccount);
  window.addEventListener('flow:calendar-status',()=>{if(view.page==='agenda')render()});
  window.addEventListener('flow:cloud-save',async event=>{
    if(event.detail?.key!==STORAGE_KEY||workspace.mode!=='cloud')return;
    const requestId=event.detail.requestId;
    try{const next=storedWorkspace();if(!next||!replaceWorkspace(next)||!db.tasks.some(t=>t.gmailCaptureId===requestId))throw new Error('A demanda não foi recebida pelo UlbraFlow. Recarregue o app e tente novamente.');await cloud.flush(db);window.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId,ok:true}}))}
    catch(error){window.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId,ok:false,error:error.message}}))}
  });
  window.addEventListener('online',()=>{cloud.flush().catch(()=>{});globalThis.FlowCalendar.schedule()});
  $('.brand').addEventListener('click',e=>{e.preventDefault();openPage('esteira')});
  // Atualiza os rótulos; a contagem decorre dos timestamps, não da frequência do setInterval.
  setInterval(tick,1000);
  setInterval(()=>{const previous=db.projectTrash?.length||0;db.projectTrash=(db.projectTrash||[]).filter(entry=>entry.expiresAt>Date.now());if(db.projectTrash.length!==previous){persist();if(view.page==='meus-projetos')render();}},3600000);
  // Botão de backup facilmente acessível sem ocupar uma sexta tela.
  const nav=document.querySelector('.sidebar-foot');const backup=document.createElement('button');backup.className='button small workspace-settings';backup.type='button';backup.dataset.action='settings';backup.title='Exportar ou importar os dados';backup.textContent='⚙';nav.appendChild(backup);
  globalThis.FlowCalendar.initialize(()=>db,persist);
  // O menu e o ⚙ sempre são liberados, mesmo que a primeira tela falhe; dados ilegíveis ficam preservados.
  try{
    if(recovering)renderFailure('Não foi possível abrir seus dados','Eles foram preservados sem alterações. Exporte uma cópia ou importe um backup em Dados do UlbraFlow.',startupError);
    else if(render())persistNow();
    updateAccount();handleCapture();
    if(pendingShare&&!recovering)newTask({title:pendingShare.title||'Mensagem compartilhada',description:[pendingShare.text,pendingShare.url].filter(Boolean).join('\n\n').slice(0,7500),shareId:pendingShare.id,sharedUrl:pendingShare.url});
  }catch(error){console.error(error);notice(error?.message||'Não foi possível concluir a abertura do UlbraFlow.')}
  finally{document.querySelectorAll('.sidebar,.top-actions').forEach(node=>{node.inert=false});finishStartup()}
  if(view.page==='entrada'&&cloud.gmailToken())FlowGmailReview.refresh().then(()=>FlowGmailReview.analyze(()=>db,persist));
  setInterval(()=>{if(view.page==='tempo'&&!document.hidden&&!db.focus?.endsAt)return;if(view.page==='tempo'&&!document.hidden)render()},60000);
})();
