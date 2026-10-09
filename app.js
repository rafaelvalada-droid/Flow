/* Flow v1: local-first. Um único arquivo para facilitar o entendimento e a edição no VS Code. */
(() => {
  'use strict';
  const STORAGE_KEY = 'flow.workspace.v1';
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
    const ps=[
      {id:'carga',name:'Carga Horária Docente',color:'#9270d4'},
      {id:'oferta',name:'Oferta de Turmas',color:'#507ee9'},
      {id:'cpa',name:'CPA / Avaliação',color:'#2ca79a'},
      {id:'ouv',name:'Ouvidoria',color:'#dbab56'},
      {id:'folha',name:'Folha Docente',color:'#418d9d'},
      {id:'pj',name:'Contratos PJ',color:'#ca8265'}
    ];
    const task=(id,title,project,plannedAfter,dueAfter,description,subs=[])=>({id,title,project,status:'todo',priority:'medium',plannedDate:addDays(plannedAfter),plannedTime:'',dueDate:addDays(dueAfter),description,subtasks:subs.map(text=>({id:uuid(),text,done:false})),sessions:[],startedAt:null,gmailUrl:'',gmailSubject:'',gmailSender:'',createdAt:Date.now(),completedAt:null});
    const ts=[
      task('t1','Conferir carga horária docente', 'carga',1,4,'Conferir os lançamentos da competência, validar os ajustes e preparar retorno à coordenação.',['Conferir lançamentos','Validar divergências','Responder ao setor']),
      task('t2','Revisar turmas com baixa ocupação','oferta',2,5,'Revisar os dados de ocupação e encaminhar ajustes necessários.',['Conferir painel de ocupação','Identificar turmas prioritárias']),
      task('t3','Analisar resultados da Avaliação Institucional','cpa',5,8,'Revisar os indicadores e organizar uma síntese para os setores envolvidos.'),
      task('t4','Acompanhar devolutivas pendentes','ouv',3,6,'Verificar manifestações aguardando retorno dos setores.')
    ];
    ts[0].priority='high';ts[1].status='doing';ts[1].priority='high';ts[3].status='waiting';
    return {version:1,projects:ps,tasks:ts,preferences:{reminderDays:1,alerts:[true,true,true,false]}};
  }
  function load(){try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));if(raw?.version===1 && Array.isArray(raw.projects)&&Array.isArray(raw.tasks))return raw}catch{}return seed()}
  let db=workflow.normalize(load());
  workflow.reconcile(db);
  let view={page:'esteira',focusId:null,selectedId:db.tasks[0]?.id||null,projectFilter:'all',statusFilter:'open',projectBoard:'all',mailSelected:null,weekOffset:0,aiMode:'improve',aiSuggestion:null,aiLoading:false};
  let accessToken='';
  let toastTimeout;
  const persist=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(db))}catch(e){notice('Não foi possível salvar os dados. Verifique o espaço disponível no navegador.')}};
  const findTask=id=>db.tasks.find(t=>t.id===id);
  const selectedTask=()=>findTask(view.selectedId)||db.tasks[0];
  const findProject=id=>db.projects.find(p=>p.id===id);
  const projectName=id=>findProject(id)?.name||'Sem área';
  const persistAndRender=()=>{persist();render()};
  const badge=(s)=>`<span class="pill ${s==='done'?'green':s==='doing'?'blue':s==='waiting'?'gold':''}">${html(nameOfStatus[s]||s)}</span>`;
  const button=(label,action,primary=false,extra='')=>`<button type="button" class="button ${primary?'primary':''}" data-action="${action}" ${extra}>${label}</button>`;
  const pageHead=(title,subtitle,right='')=>`<div class="page-head"><div><div class="eyebrow">FLOW / WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`;
  const selectedFilterTasks=()=>db.tasks.filter(t=>(view.projectFilter==='all'||t.project===view.projectFilter)&&(view.statusFilter==='all'||(view.statusFilter==='open'?t.status!=='done':workflow.stage(db,t)===view.statusFilter)));
  const projOption=(current='all',all=true)=>`${all?'<option value="all">Todas as áreas</option>':`<option value="" ${!current?'selected':''}>Escolha uma área</option>`}${db.projects.map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''}>${html(p.name)}</option>`).join('')}`;
  const statusOption=(s,includeInbox=false)=>Object.entries(nameOfStatus).filter(([key])=>includeInbox||key!=='inbox').map(([key,name])=>`<option value="${key}" ${s===key?'selected':''}>${name}</option>`).join('');
  function notice(text){const box=$('#toast');box.textContent=text;box.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>box.classList.remove('visible'),3400)}
  function titleRow(title, right=''){return `<div class="between"><h3 class="sectiontitle">${title}</h3>${right}</div>`}

  const countdown=ms=>{const seconds=Math.ceil(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`};
  const urgencyBadge=t=>{const u=workflow.urgency(t);return `<span class="urgency ${u.tone}">${html(u.label)}${t.dueDate&&t.status!=='done'?` · ${dateLabel(t.dueDate)}`:''}</span>`};
  const areaBadge=t=>`<span class="area-label"><i style="background:${html(/^#[a-f0-9]{6}$/i.test(findProject(t.project)?.color||'')?findProject(t.project).color:'#8998ae')}"></i>${html(projectName(t.project))}</span>`;
  const nextTask=()=>db.tasks.filter(t=>workflow.classified(db,t)&&['todo','doing'].includes(t.status)).sort(workflow.byDue)[0];
  const focusTask=()=>findTask(db.focus?.taskId)||db.tasks.find(t=>t.id===view.focusId&&t.status!=='done'&&workflow.classified(db,t))||nextTask()||db.tasks.filter(t=>t.status!=='done'&&workflow.classified(db,t)).sort(workflow.byDue)[0];
  const workflowTrail=()=>'<div class="workflow-trail"><span><b>01</b> Classificar</span><i>→</i><span><b>02</b> Organizar na esteira</span><i>→</i><span><b>03</b> Entrar em foco</span></div>';

  function renderInbox(){
    const tasks=db.tasks.filter(t=>workflow.stage(db,t)==='inbox').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return pageHead('Primeiro, dê um destino.','Duas perguntas para cada demanda: para onde vai e para quando?',button('+ Capturar demanda','new-task',true))+workflowTrail()+`<section class="card inbox-card"><div class="between"><h3 class="sectiontitle">A classificar</h3><span class="pill">${tasks.length} demandas</span></div>${tasks.map(t=>`<article class="inbox-item"><div><button class="text-button" data-task="${html(t.id)}">${html(t.title)}</button><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}${t.gmailUrl?'<span class="pill">✉ Gmail</span>':''}</div></div>${button('Classificar →','classify-task',true,`data-id="${html(t.id)}"`)}</article>`).join('')||`<div class="empty inbox-empty"><span>✓</span><h2>Entrada em dia.</h2><p>As demandas já têm destino e data. Seu trabalho está na esteira.</p>${button('Ir para a esteira','show-pipeline',true)}</div>`}</section>`;
  }
  function renderPipeline(){
    const open=db.tasks.filter(t=>t.status!=='done'), today=localDate();
    const inbox=open.filter(t=>workflow.stage(db,t)==='inbox').length;
    const late=open.filter(t=>workflow.classified(db,t)&&t.dueDate<today).length;
    const dueToday=open.filter(t=>workflow.classified(db,t)&&t.dueDate===today).length;
    const focus=findTask(db.focus?.taskId), next=focus||nextTask();
    const visible=db.tasks.filter(t=>view.projectBoard==='all'||t.project===view.projectBoard).sort(workflow.byDue);
    const lanes=[['inbox','A classificar','Definir área e data'],['todo','A fazer','Próximas demandas'],['doing','Em andamento','Trabalho iniciado'],['waiting','Aguardando','Depende de um retorno'],['done','Concluídas','Trabalho entregue']].map(([status,title,subtitle])=>{
      const tasks=visible.filter(t=>workflow.stage(db,t)===status);
      return `<section class="pipeline-lane" data-stage="${status}"><div class="lanehead"><span>${title}</span><span class="lane-count">${tasks.length}</span></div><p class="lane-subtitle">${subtitle}</p>${tasks.map(t=>`<article class="pipeline-task ${active(t)?'in-focus':''}"><button class="text-button" data-task="${html(t.id)}">${html(t.title)}</button><div class="task-meta">${areaBadge(t)}${urgencyBadge(t)}</div>${active(t)?'<span class="focus-indicator">● Em foco agora</span>':''}${t.gmailUrl?'<span class="mail-indicator">✉ E-mail vinculado</span>':''}<div class="pipeline-actions">${status==='inbox'?button('Classificar','classify-task',false,`data-id="${html(t.id)}"`):status!=='done'?button(active(t)?'Abrir foco':'Focar','focus-task',false,`data-id="${html(t.id)}"`):'<span class="completed-label">✓ Entregue</span>'}${button('Detalhes','task-detail',false,`data-task="${html(t.id)}"`)}</div>${status!=='inbox'?`<select class="lane-move" data-move-task="${html(t.id)}" aria-label="Mover ${html(t.title)} para outra etapa"><option value="">Mover etapa…</option>${Object.entries(nameOfStatus).filter(([key])=>key!=='inbox'&&key!==status).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select>`:''}</article>`).join('')||'<div class="lane-empty">Nenhuma demanda aqui.</div>'}</section>`;
    }).join('');
    return pageHead('Uma esteira. Todas as demandas.','As áreas organizam a origem. Você escolhe uma tarefa de cada vez.',button('+ Nova demanda','new-task',true))+`<div class="pipeline-summary"><button data-page="entrada"><span>A classificar</span><strong>${inbox}</strong></button><div><span>Para hoje</span><strong>${dueToday}</strong></div><div class="${late?'has-late':''}"><span>Atrasadas</span><strong>${late}</strong></div><button data-page="foco"><span>${focus?'Seu foco':'Próximo foco'}</span><strong class="summary-task">${html(next?.title||'Escolha uma demanda')}</strong><small>${focus?'Abrir sessão →':'Entrar em foco →'}</small></button></div><div class="pipeline-toolbar"><div><h3 class="sectiontitle">Esteira comum</h3><p>Datas mais próximas aparecem primeiro em cada etapa.</p></div><label class="field">Área<select id="board-filter" class="filterselect">${projOption(view.projectBoard)}</select></label></div><div class="pipeline-board">${lanes}</div><p class="board-footnote">Use Mover etapa para encaminhar a demanda. A área acompanha a tarefa em toda a esteira.</p>`;
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
    const list=`<section class="card"><div class="between"><h3 class="sectiontitle">Minhas demandas</h3><span class="pill">${filtered.length}</span></div><div class="filters"><select class="filterselect" id="filter-project" aria-label="Filtrar por área">${projOption(view.projectFilter)}</select><select class="filterselect" id="filter-status" aria-label="Filtrar por situação"><option value="open" ${view.statusFilter==='open'?'selected':''}>Em aberto</option><option value="all" ${view.statusFilter==='all'?'selected':''}>Todas</option>${statusOption(view.statusFilter,true)}</select></div>${filtered.map(x=>`<button type="button" class="task-list-item ${x.id===t?.id?'selected':''}" data-task="${html(x.id)}"><strong>${html(x.title)}</strong><small>${html(projectName(x.project))} · ${dateLabel(x.dueDate)}</small><div class="status-line">${badge(workflow.stage(db,x))}${x.gmailUrl?'<span class="pill">✉ Gmail</span>':''}${active(x)?'<span class="pill blue">● Cronometrando</span>':''}</div></button>`).join('')||'<div class="empty">Nenhuma tarefa neste filtro.</div>'}</section>`;
    if(!t)return pageHead('Tarefas','Organize e execute suas demandas.')+list;
    view.selectedId=t.id;
    const len=t.sessions.length, last=t.sessions.filter(s=>s.end).slice(-3).reverse();
    const history=last.length?last.map(s=>`<div class="time-record">${new Date(s.start).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${secondsLabel(Math.floor((s.end-s.start)/1000))}</div>`).join(''):'<p class="muted smalltext">Nenhuma sessão encerrada ainda.</p>';
    const origin=t.gmailUrl?`<div class="originbox"><b>✉ E-mail vinculado</b><div>${html(t.gmailSubject||'Conversa original')}</div><div style="margin-top:6px">${html(t.gmailSender)}</div><button class="button small" data-action="open-email" type="button">↗ Abrir conversa original</button></div>`:'';
    const result=view.aiSuggestion?`<div class="ai-suggestion"><h4>✧ Sugestão recebida do Gemini</h4><textarea id="ai-output" aria-label="Texto gerado para revisão">${html(view.aiSuggestion.text)}</textarea><div class="row" style="flex-wrap:wrap">${button(view.aiSuggestion.mode==='subtasks'?'Criar subtarefas':'Aplicar à descrição','apply-ai',true)}${button('Copiar texto','copy-ai')}${button('Descartar','discard-ai')}</div></div>`:'';
    const detail=`<section class="card"><div class="between"><span class="pill blue">${html(projectName(t.project))}</span>${badge(workflow.stage(db,t))}</div><h2 class="detail-title">${html(t.title)}</h2>${!workflow.classified(db,t)&&t.status!=='done'?`<div class="classification-hint">Defina a área e a data para colocar esta demanda na esteira. ${button('Classificar','classify-task',true,`data-id="${html(t.id)}"`)}</div>`:''}
      <div class="detail-grid">
        <label class="field">Título<input id="edit-title" value="${html(t.title)}" maxlength="180" /></label>
        <label class="field">Área<select id="edit-project">${projOption(t.project,false)}</select></label>
        <label class="field">Situação<select id="edit-status">${statusOption(t.status)}</select></label>
        <div class="field">Urgência pela data<div class="urgency-line">${urgencyBadge(t)}</div></div>
        <label class="field">Data de execução<input id="edit-planned" type="date" value="${html(t.plannedDate||'')}" /></label>
        <label class="field">Hora planejada<input id="edit-time" type="time" value="${html(t.plannedTime||'')}" /></label>
        <label class="field">Prazo final<input id="edit-due" type="date" value="${html(t.dueDate||'')}" /></label>
        <label class="field">Agenda Google (.ics)<button class="button" style="margin-top:6px;display:block;width:100%" data-action="export-ics" type="button">↧ Exportar evento</button></label>
      </div>
      <div class="timerbox"><div class="label">◷ TEMPO DE TRABALHO</div><div class="timer-value" data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</div><div class="timer-meta">${active(t)?'● Ciclo de foco em andamento':'Tempo registrado de trabalho'} · ${len} ${len===1?'sessão':'sessões'} no histórico</div><div class="actionbar">${active(t)?button('Ⅱ Pausar','pause',true):button('Entrar em foco','start',true)}${button('✓ Concluir','complete')}${t.gmailUrl?button('↗ Voltar ao Gmail','open-email'):''}</div></div>
      ${titleRow('Subtarefas',`<span class="pill">${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length}</span>`)}${t.subtasks.map(s=>`<label class="subtask ${s.done?'done':''}"><input type="checkbox" data-sub="${html(s.id)}" ${s.done?'checked':''} /><span>${html(s.text)}</span><button class="button small ghost right" type="button" data-delete-sub="${html(s.id)}" aria-label="Excluir subtarefa">✕</button></label>`).join('')||'<div class="muted smalltext" style="margin-top:10px">Ainda não há subtarefas.</div>'}
      <form class="inline-add" id="sub-form"><input name="title" required placeholder="+ Adicionar subtarefa" maxlength="180"/><button class="button small" type="submit">Adicionar</button></form>
      ${origin}<div class="divider"></div>
      <div class="ai-head"><h3 class="sectiontitle">Descrição e assistente Gemini</h3><span class="pill blue">✧ IA</span></div><label class="field">Contexto e anotações<textarea id="edit-description" rows="5" maxlength="7500">${html(t.description)}</textarea></label>
      <div class="ai-control"><select id="ai-mode" aria-label="Tipo de auxílio"><option value="improve" ${view.aiMode==='improve'?'selected':''}>Melhorar descrição</option><option value="reply" ${view.aiMode==='reply'?'selected':''}>Criar resposta ao setor</option><option value="subtasks" ${view.aiMode==='subtasks'?'selected':''}>Sugerir subtarefas</option></select><button type="button" class="button primary" data-action="gemini" ${view.aiLoading?'disabled':''}>${view.aiLoading?'Consultando…':'✧ Gerar com Gemini'}</button></div>
      <div class="smalltext muted" style="margin-top:9px">A descrição é enviada à API Gemini somente quando você clicar no botão. Revise o texto antes de aplicar ou enviar.</div>${result}
      <div class="divider"></div>${titleRow('Histórico do cronômetro')}<div style="margin-top:10px">${history}</div><div class="actionbar" style="justify-content:flex-end">${button('Excluir tarefa','delete-task',false,'') }</div>
    </section>`;
    return pageHead('Detalhe da tarefa','Área e data classificam a demanda. A execução acontece na esteira comum.',button('← Esteira','show-pipeline'))+`<div class="layout-task">${list}${detail}</div>`;
  }
  function renderProjects(){
    const cards=db.projects.map(p=>{const group=db.tasks.filter(t=>t.project===p.id),closed=group.filter(t=>t.status==='done').length,percent=group.length?Math.round(closed*100/group.length):0;return `<button class="projectcard" data-project="${html(p.id)}"><div class="between"><div class="projecticon" style="background:${p.color}18;color:${p.color}">▦</div><span class="pill">${group.length} tarefas</span></div><strong>${html(p.name)}</strong><p>${group.length-closed} abertas · ${closed} concluídas</p><div class="progressbar"><i style="width:${percent}%;background:${p.color}"></i></div></button>`}).join('');
    return pageHead('Áreas','De onde vêm as demandas. Todas seguem pela mesma esteira.',button('+ Criar área','new-project',true))+`<div class="projectgrid">${cards||'<div class="empty">Nenhuma área criada.</div>'}</div><div class="notice" style="margin-top:20px">Use as áreas para classificar e consultar. ${button('Abrir esteira comum','show-pipeline')}</div>`;
  }
  function renderCalendar(){
    const today=new Date();today.setHours(12,0,0,0);const dow=(today.getDay()+6)%7;
    const monday=new Date(today);monday.setDate(today.getDate()-dow+view.weekOffset*7);
    const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d});
    const range=`${days[0].toLocaleDateString('pt-BR',{day:'numeric',month:'short'})} – ${days[6].toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})}`;
    return pageHead('Agenda','Veja a execução planejada de cada tarefa no calendário.',button('+ Nova tarefa','new-task',true))+`<section class="card" style="margin-bottom:14px"><div class="calendar-toolbar"><strong>${range}</strong><div class="row">${button('←','week-previous')}${button('Semana atual','week-reset')}${button('→','week-next')}</div></div></section><div class="calendar-grid">${days.map((d,i)=>{const date=localDate(d);const matches=db.tasks.filter(t=>t.plannedDate===date).sort((a,b)=>(a.plannedTime||'').localeCompare(b.plannedTime||''));return `<div class="calendar-day"><small>${['SEG','TER','QUA','QUI','SEX','SÁB','DOM'][i]}</small><strong>${d.getDate()}</strong>${matches.map(t=>`<button data-task="${html(t.id)}" class="calendar-event"><time>${html(t.plannedTime||'Dia inteiro')}</time>${html(t.title)}</button>`).join('')}</div>`}).join('')}</div><section class="notice" style="margin-top:17px">A agenda do Flow usa a <b>data de execução</b>. O <b>prazo final</b> permanece separado. Você já pode exportar um evento em formato .ics e importá-lo no Google Agenda; a sincronização automática por OAuth entra na próxima etapa.</section>`;
  }
  function renderGmail(){
    const linked=db.tasks.filter(t=>t.gmailUrl);
    const mail=view.mailSelected?findTask(view.mailSelected):null;
    const extensionSetup=`<section class="notice" style="margin-bottom:18px"><b>Incluir no Flow, direto no Gmail</b><p>Instale a extensão no Chrome. Ao abrir uma conversa, clique em <b>Incluir no Flow</b>, escolha a área e a data e salve. O e-mail entra na esteira comum.</p><a class="button primary" href="./downloads/flow-gmail-extension.zip" download>↓ Baixar extensão para Gmail</a><p class="smalltext" style="margin-bottom:0">Extraia o ZIP. Em chrome://extensions, ative Modo do desenvolvedor, clique em Carregar sem compactação e escolha a pasta flow-gmail. Depois, recarregue o Gmail. O Flow permanece conectado em uma aba de apoio.</p></section>`;
    return pageHead('Gmail + Flow','Cada e-mail vira uma tarefa, sem perder o acesso à conversa original.',button('+ Vincular e-mail','link-email',true))+extensionSetup+`<div class="mailgrid"><section class="card"><div class="between"><h3 class="sectiontitle">Conversas vinculadas</h3><span class="pill">${linked.length}</span></div><div style="margin-top:13px">${linked.map(t=>`<button class="mail-link" data-mail-task="${html(t.id)}"><b>${html(t.gmailSubject||t.title)}</b><small>${html(t.gmailSender||'Gmail')} · ${html(projectName(t.project))}</small></button>`).join('')||'<div class="empty">Nenhuma conversa vinculada. Use a extensão ou o botão de vinculação.</div>'}</div></section><section class="card">${mail?`<div class="eyebrow">E-MAIL DE ORIGEM</div><h2 class="mail-subject">${html(mail.gmailSubject||mail.title)}</h2><p class="smalltext muted">${html(mail.gmailSender||'Remetente não registrado')}</p><div class="divider"></div><p class="smalltext">Esta conversa está associada à tarefa <strong>${html(mail.title)}</strong>.</p><div class="actionbar">${button('↗ Abrir Gmail','open-linked-email',true)}${button('Abrir tarefa no Flow','open-mail-task')}</div>`:`<div class="eyebrow">EXTENSÃO CHROME</div><h2 class="mail-subject">Capture e retorne ao e-mail</h2><p class="smalltext muted">A extensão adiciona o botão Incluir no Flow ao lado do assunto da conversa no Gmail. Escolha a área e a data na caixa e salve sem sair do e-mail.</p><div class="notice" style="margin-top:16px">A tarefa recebe o assunto, o remetente e o link da conversa. Você pode abrir o e-mail original a partir do Flow.</div>`}</section></div>`;
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
    const names={entrada:'Entrada',esteira:'Esteira',foco:'Foco',tarefas:'Tarefa',projetos:'Áreas',agenda:'Agenda',gmail:'Gmail',alertas:'Alertas'};
    $('#location-label').textContent=names[view.page];document.title=`Flow — ${names[view.page]}`;
    document.querySelectorAll('#sidebar-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===view.page));
    const inbox=db.tasks.filter(t=>workflow.stage(db,t)==='inbox').length;
    const count=$('#inbox-count');if(count){count.textContent=inbox;count.hidden=!inbox}
    $('#screen').innerHTML=({entrada:renderInbox,esteira:renderPipeline,foco:renderFocus,tarefas:renderTasks,projetos:renderProjects,agenda:renderCalendar,gmail:renderGmail,alertas:renderAlerts})[view.page]();tick();
  }
  function stop(t){if(!t)return;if(db.focus?.taskId===t.id)workflow.pause(db);else workflow.cancel(db,t.id)}
  function start(t){
    if(!t)return;
    if(t.status==='done'){notice('Reabra a tarefa antes de iniciar um ciclo.');return}
    if(!workflow.classified(db,t)){classifyTask(t,()=>start(t));return}
    workflow.start(db,t.id);view.focusId=t.id;persist();openPage('foco');notice('Uma tarefa, um ciclo de foco.');
  }
  function complete(t){if(!t)return;workflow.cancel(db,t.id);t.status='done';t.completedAt=Date.now();persistAndRender();notice('Tarefa concluída. Tempo de trabalho preservado.')}
  function openPage(page){if(!['entrada','esteira','foco','tarefas','projetos','agenda','gmail','alertas'].includes(page))return;view.page=page;view.aiSuggestion=null;render();document.querySelector('.screen').scrollTo(0,0)}
  function selectTask(id){view.selectedId=id;view.projectFilter='all';view.statusFilter='all';openPage('tarefas')}
  function openGmail(t){const url=validGmailUrl(t?.gmailUrl);if(!url){notice('Não há um link válido do Gmail nesta tarefa.');return}window.open(url,'_blank','noopener,noreferrer')}
  function download(filename, content, type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportIcs(t){if(!t?.plannedDate){notice('Informe a data de execução antes de exportar o evento.');return}const d=t.plannedDate.replaceAll('-','');let start='',end='';if(t.plannedTime){const dt=new Date(`${t.plannedDate}T${t.plannedTime}:00`);start=`DTSTART:${dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;end=`DTEND:${new Date(dt.getTime()+30*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`}else{const next=new Date(`${t.plannedDate}T12:00:00`);next.setDate(next.getDate()+1);start=`DTSTART;VALUE=DATE:${d}`;end=`DTEND;VALUE=DATE:${localDate(next).replaceAll('-','')}`}const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flow Workspace//PT-BR//EN','BEGIN:VEVENT',`UID:${t.id}@flow.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,start,end,`SUMMARY:${escapeIcs(t.title)}`,`DESCRIPTION:${escapeIcs(t.description+(t.gmailUrl?'\nGmail: '+t.gmailUrl:''))}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');download(`flow-${t.id}.ics`,text,'text/calendar;charset=utf-8');notice('Evento .ics exportado. Importe o arquivo no Google Agenda.')}
  function promptModal({title,subtitle,content,onSubmit,ok='Salvar'}){
    const box=$('#modal-backdrop');box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${html(title)}"><h2>${html(title)}</h2><p>${html(subtitle)}</p><form id="active-modal-form">${content}<div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">${html(ok)}</button></div></form></div>`;box.classList.remove('hidden');box._submit=onSubmit;box.querySelector('input,select')?.focus();
  }
  const closeModal=()=>{$('#modal-backdrop').classList.add('hidden');$('#modal-backdrop').innerHTML=''};
  function newProject(){promptModal({title:'Nova área',subtitle:'Organize suas demandas em uma nova área.',content:`<label class="field">Nome da área<input name="name" required maxlength="70" placeholder="Ex.: Planejamento Acadêmico" /></label><label class="field">Cor<select name="color"><option value="#507ee9">Azul</option><option value="#9270d4">Violeta</option><option value="#2ca79a">Verde</option><option value="#dbab56">Dourado</option></select></label>`,onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;db.projects.push({id:uuid(),name,color:String(data.get('color'))});persistAndRender();notice('Área criada.');return true}})}
  function newTask(prefill={}){
    const isMail=!!prefill.gmailUrl;
    const content=`<label class="field">O que precisa ser feito?<input name="title" required maxlength="180" value="${html(prefill.title||'')}" placeholder="Ex.: Conferir folha docente" /></label><div class="classification-questions"><label class="field">1. Para onde vai?<select name="project">${projOption(prefill.project||'',false)}</select></label><label class="field">2. Para quando?<input type="date" name="dueDate" value="${html(prefill.dueDate||'')}" /></label></div><p class="smalltext muted">Se ainda não souber a área ou a data, salve na Entrada e classifique depois.</p><label class="field">Contexto (opcional)<textarea name="description" rows="3" maxlength="7500">${html(prefill.description||'')}</textarea></label>${isMail?`<div class="notice" style="margin-top:13px">✉ ${html(prefill.gmailSubject||prefill.gmailUrl)}</div>`:''}`;
    promptModal({title:isMail?'Incluir e-mail no Flow':'Nova demanda',subtitle:'Capture a demanda. Área e data colocam a tarefa na esteira.',content,onSubmit:data=>{
      const title=String(data.get('title')||'').trim();if(!title)return false;
      const t={id:uuid(),title,project:String(data.get('project')||''),status:'todo',priority:'medium',plannedDate:prefill.plannedDate||'',plannedTime:'',dueDate:String(data.get('dueDate')||''),description:String(data.get('description')||''),subtasks:[],sessions:[],startedAt:null,focusCycles:0,gmailUrl:validGmailUrl(prefill.gmailUrl||''),gmailSubject:String(prefill.gmailSubject||''),gmailSender:String(prefill.gmailSender||''),createdAt:Date.now(),completedAt:null};
      db.tasks.unshift(t);view.selectedId=t.id;persist();openPage(workflow.classified(db,t)?'esteira':'entrada');notice(workflow.classified(db,t)?'Demanda incluída na esteira.':'Demanda capturada. Falta classificar área e data.');return true;
    },ok:'Salvar demanda'});
  }
  function classifyTask(t,after){
    if(!t)return;
    promptModal({title:'Classificar demanda',subtitle:t.title,content:`<div class="classification-questions"><label class="field">1. Para onde vai?<select name="project" required>${projOption(t.project||'',false)}</select></label><label class="field">2. Para quando?<input type="date" name="dueDate" required value="${html(t.dueDate||'')}" /></label></div><p class="smalltext muted">A área identifica a demanda. A data determina sua urgência na esteira comum.</p>`,onSubmit:data=>{
      const project=String(data.get('project')||''),dueDate=String(data.get('dueDate')||'');
      if(!findProject(project)||!workflow.validDate(dueDate))return false;
      t.project=project;t.dueDate=dueDate;if(t.status==='inbox')t.status='todo';persist();
      if(after)after();else openPage('esteira');notice('Demanda classificada.');return true;
    },ok:'Incluir na esteira'});
  }
  function linkMail(){promptModal({title:'Vincular conversa do Gmail',subtitle:'Cole o link da conversa e associe a uma nova tarefa.',content:`<label class="field">Link da conversa<input name="url" type="url" required placeholder="https://mail.google.com/mail/u/0/#..." /></label><label class="field">Assunto<input name="subject" required maxlength="180" placeholder="Assunto do e-mail" /></label><label class="field">Remetente (opcional)<input name="sender" maxlength="150" placeholder="Setor responsável" /></label>`,onSubmit:data=>{const gmailUrl=validGmailUrl(String(data.get('url')));if(!gmailUrl){notice('Cole um endereço HTTPS válido de mail.google.com.');return false}const gmailSubject=String(data.get('subject')||'').trim();const gmailSender=String(data.get('sender')||'').trim();newTask({title:`Responder: ${gmailSubject}`,gmailUrl,gmailSubject,gmailSender});return false},ok:'Continuar'})}
  function exportData(){download(`flow-backup-${localDate()}.json`,JSON.stringify(db,null,2),'application/json');notice('Cópia de segurança exportada.')}
  function importData(){promptModal({title:'Importar backup',subtitle:'Atenção: esta operação substitui todos os dados deste navegador.',content:`<label class="field">Arquivo JSON do Flow<input name="file" type="file" accept=".json,application/json" required /></label>`,onSubmit:()=>false,ok:'Importar'});const form=$('#active-modal-form');form.addEventListener('submit',async e=>{e.preventDefault();const file=form.elements.file.files?.[0];if(!file)return;try{const val=JSON.parse(await file.text());if(val?.version!==1||!Array.isArray(val.projects)||!Array.isArray(val.tasks))throw new Error();if(!confirm('Substituir todas as tarefas e áreas atuais pelo backup?'))return;db=workflow.normalize(val);workflow.reconcile(db);view.selectedId=db.tasks[0]?.id||null;persist();closeModal();render();notice('Backup importado com sucesso.')}catch{notice('Backup inválido ou incompatível.')}},{once:true})}
  function settingsModal(){promptModal({title:'Dados do Flow',subtitle:'A versão inicial salva suas informações apenas neste navegador.',content:`<div class="notice">Faça uma cópia de segurança regularmente. Sem login e banco de dados, apagar os dados do navegador pode eliminar tarefas e históricos.</div><div class="row" style="margin-top:15px;flex-wrap:wrap"><button type="button" class="button" data-action="export-data">↓ Exportar backup</button><button type="button" class="button" data-action="import-data">↑ Importar backup</button></div>`,onSubmit:()=>true,ok:'Fechar'})}

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
  document.addEventListener('click',async e=>{
    const element=e.target.closest('button');if(!element)return;
    const page=element.dataset.page;
    if(page){openPage(page);return}
    const id=element.dataset.task;if(id){selectTask(id);return}
    const p=element.dataset.project;if(p){view.projectFilter=p;view.statusFilter='all';view.selectedId=db.tasks.find(t=>t.project===p)?.id||db.tasks[0]?.id;openPage('tarefas');return}
    const mailId=element.dataset.mailTask;if(mailId){view.mailSelected=mailId;render();return}
    const subid=element.dataset.deleteSub;if(subid){const t=selectedTask();t.subtasks=t.subtasks.filter(s=>s.id!==subid);persistAndRender();return}
    if(element.dataset.alert!==undefined){const i=Number(element.dataset.alert);db.preferences.alerts[i]=!db.preferences.alerts[i];persistAndRender();return}
    const t=selectedTask();switch(element.dataset.action){
      case 'new-task':newTask();break;
      case 'new-project':newProject();break;
      case 'close-modal':closeModal();break;
      case 'open-active':openPage('foco');break;
      case 'show-pipeline':openPage('esteira');break;
      case 'show-inbox':openPage('entrada');break;
      case 'classify-task':classifyTask(findTask(element.dataset.id)||t);break;
      case 'focus-task':start(findTask(element.dataset.id));break;
      case 'focus-start':start(focusTask());break;
      case 'focus-pause':workflow.pause(db);persistAndRender();break;
      case 'break-resume':workflow.resumeBreak(db);persistAndRender();break;
      case 'focus-change':if(db.focus)workflow.cancel(db,db.focus.taskId);view.focusId=null;persistAndRender();break;
      case 'focus-complete':complete(focusTask());break;
      case 'start':start(t);break;
      case 'pause':stop(t);persistAndRender();notice('Cronômetro pausado.');break;
      case 'complete':complete(t);break;
      case 'delete-task':if(confirm('Excluir a tarefa e todo seu histórico de tempo?')){workflow.cancel(db,t.id);db.tasks=db.tasks.filter(x=>x.id!==t.id);view.selectedId=db.tasks[0]?.id||null;persistAndRender();notice('Tarefa excluída.')}break;
      case 'open-email':openGmail(t);break;
      case 'open-linked-email':openGmail(findTask(view.mailSelected));break;
      case 'open-mail-task':selectTask(view.mailSelected);break;
      case 'export-ics':exportIcs(t);break;
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
    }
  });
  document.addEventListener('submit',e=>{
    if(e.target.id==='sub-form'){e.preventDefault();const txt=e.target.elements.title.value.trim();if(!txt)return;selectedTask().subtasks.push({id:uuid(),text:txt.slice(0,180),done:false});persistAndRender()}
    if(e.target.id==='active-modal-form'){e.preventDefault();const submit=$('#modal-backdrop')._submit;if(!submit)return;const result=submit(new FormData(e.target));if(result!==false)closeModal()}
  });
  document.addEventListener('change',e=>{
    const x=e.target,t=selectedTask();
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
  $('.brand').addEventListener('click',e=>{e.preventDefault();openPage('esteira')});
  // Atualiza os rótulos; a contagem decorre dos timestamps, não da frequência do setInterval.
  setInterval(tick,1000);
  // Botão de backup facilmente acessível sem ocupar uma sexta tela.
  const nav=document.querySelector('.sidebar-foot');const backup=document.createElement('button');backup.className='button small';backup.type='button';backup.dataset.action='settings';backup.title='Exportar ou importar os dados';backup.style.cssText='margin-left:auto;padding:5px 7px;background:#314b74;border-color:#48618a;color:#d5e3fd';backup.textContent='⚙';nav.appendChild(backup);
  persist();render();handleCapture();
})();
