/* Flow v1: local-first. Um único arquivo para facilitar o entendimento e a edição no VS Code. */
(() => {
  'use strict';
  const STORAGE_KEY = 'flow.workspace.v1';
  const $ = (selector) => document.querySelector(selector);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uuid = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const addDays = (n) => { const date = new Date(); date.setDate(date.getDate()+n); return localDate(date); };
  const dateLabel = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','') : 'Sem data';
  const secondsLabel = (total) => [Math.floor(total/3600),Math.floor(total%3600/60),total%60].map(x=>String(x).padStart(2,'0')).join(':');
  const nameOfStatus = {todo:'A fazer',doing:'Em andamento',waiting:'Aguardando',done:'Concluída'};
  const nameOfPriority = {high:'Alta',medium:'Média',low:'Baixa'};
  const sessionSeconds = t => (t.sessions||[]).reduce((sum,s) => sum+Math.max(0, Math.floor(((s.end||Date.now())-s.start)/1000)),0);
  const active = t => !!t.startedAt;
  const escapeIcs = str => String(str||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const validGmailUrl = value => {try {const url = new URL(value);return url.protocol==='https:' && url.hostname==='mail.google.com' ? url.href : ''} catch {return ''}};

  function seed(){
    const ps=[
      {id:'carga',name:'Carga Horária Docente',color:'#9270d4'},
      {id:'oferta',name:'Oferta de Turmas',color:'#507ee9'},
      {id:'cpa',name:'CPA / Avaliação',color:'#2ca79a'},
      {id:'ouv',name:'Ouvidoria',color:'#dbab56'}
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
  let db=load();
  let view={page:'tarefas',selectedId:db.tasks[0]?.id||null,projectFilter:'all',statusFilter:'open',projectBoard:'all',mailSelected:null,weekOffset:0,aiMode:'improve',aiSuggestion:null,aiLoading:false};
  let accessToken='';
  let toastTimeout;
  const persist=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(db))}catch(e){notice('Não foi possível salvar os dados. Verifique o espaço disponível no navegador.')}};
  const findTask=id=>db.tasks.find(t=>t.id===id);
  const selectedTask=()=>findTask(view.selectedId)||db.tasks[0];
  const findProject=id=>db.projects.find(p=>p.id===id);
  const projectName=id=>findProject(id)?.name||'Sem projeto';
  const runningTask=()=>db.tasks.find(active);
  const persistAndRender=()=>{persist();render()};
  const badge=(s)=>`<span class="pill ${s==='done'?'green':s==='doing'?'blue':s==='waiting'?'gold':''}">${html(nameOfStatus[s]||s)}</span>`;
  const button=(label,action,primary=false,extra='')=>`<button type="button" class="button ${primary?'primary':''}" data-action="${action}" ${extra}>${label}</button>`;
  const pageHead=(title,subtitle,right='')=>`<div class="page-head"><div><div class="eyebrow">FLOW / WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`;
  const selectedFilterTasks=()=>db.tasks.filter(t=>(view.projectFilter==='all'||t.project===view.projectFilter)&&(view.statusFilter==='all'||(view.statusFilter==='open'?t.status!=='done':t.status===view.statusFilter)));
  const projOption=(current='all',all=true)=>`${all?'<option value="all">Todos os projetos</option>':''}${db.projects.map(p=>`<option value="${html(p.id)}" ${current===p.id?'selected':''}>${html(p.name)}</option>`).join('')}`;
  const statusOption=s=>Object.entries(nameOfStatus).map(([key,name])=>`<option value="${key}" ${s===key?'selected':''}>${name}</option>`).join('');
  const priorityOption=s=>Object.entries(nameOfPriority).map(([key,name])=>`<option value="${key}" ${s===key?'selected':''}>${name}</option>`).join('');
  function notice(text){const box=$('#toast');box.textContent=text;box.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>box.classList.remove('visible'),3400)}
  function titleRow(title, right=''){return `<div class="between"><h3 class="sectiontitle">${title}</h3>${right}</div>`}

  function renderTasks(){
    const filtered=selectedFilterTasks();
    const t=filtered.find(x=>x.id===view.selectedId)||filtered[0];
    const list=`<section class="card"><div class="between"><h3 class="sectiontitle">Minhas demandas</h3><span class="pill">${filtered.length}</span></div><div class="filters"><select class="filterselect" id="filter-project" aria-label="Filtrar por projeto">${projOption(view.projectFilter)}</select><select class="filterselect" id="filter-status" aria-label="Filtrar por situação"><option value="open" ${view.statusFilter==='open'?'selected':''}>Em aberto</option><option value="all" ${view.statusFilter==='all'?'selected':''}>Todas</option>${statusOption(view.statusFilter)}</select></div>${filtered.map(x=>`<button type="button" class="task-list-item ${x.id===t?.id?'selected':''}" data-task="${html(x.id)}"><strong>${html(x.title)}</strong><small>${html(projectName(x.project))} · ${dateLabel(x.dueDate)}</small><div class="status-line">${badge(x.status)}${x.gmailUrl?'<span class="pill">✉ Gmail</span>':''}${active(x)?'<span class="pill blue">● Cronometrando</span>':''}</div></button>`).join('')||'<div class="empty">Nenhuma tarefa neste filtro.</div>'}</section>`;
    if(!t)return pageHead('Tarefas','Organize e execute suas demandas.')+list;
    view.selectedId=t.id;
    const len=t.sessions.length, last=t.sessions.filter(s=>s.end).slice(-3).reverse();
    const history=last.length?last.map(s=>`<div class="time-record">${new Date(s.start).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${secondsLabel(Math.floor((s.end-s.start)/1000))}</div>`).join(''):'<p class="muted smalltext">Nenhuma sessão encerrada ainda.</p>';
    const origin=t.gmailUrl?`<div class="originbox"><b>✉ E-mail vinculado</b><div>${html(t.gmailSubject||'Conversa original')}</div><div style="margin-top:6px">${html(t.gmailSender)}</div><button class="button small" data-action="open-email" type="button">↗ Abrir conversa original</button></div>`:'';
    const result=view.aiSuggestion?`<div class="ai-suggestion"><h4>✧ Sugestão recebida do Gemini</h4><textarea id="ai-output" aria-label="Texto gerado para revisão">${html(view.aiSuggestion.text)}</textarea><div class="row" style="flex-wrap:wrap">${button(view.aiSuggestion.mode==='subtasks'?'Criar subtarefas':'Aplicar à descrição','apply-ai',true)}${button('Copiar texto','copy-ai')}${button('Descartar','discard-ai')}</div></div>`:'';
    const detail=`<section class="card"><div class="between"><span class="pill blue">${html(projectName(t.project))}</span>${badge(t.status)}</div><h2 class="detail-title">${html(t.title)}</h2>
      <div class="detail-grid">
        <label class="field">Título<input id="edit-title" value="${html(t.title)}" maxlength="180" /></label>
        <label class="field">Projeto<select id="edit-project">${projOption(t.project,false)}</select></label>
        <label class="field">Situação<select id="edit-status">${statusOption(t.status)}</select></label>
        <label class="field">Prioridade<select id="edit-priority">${priorityOption(t.priority)}</select></label>
        <label class="field">Data de execução<input id="edit-planned" type="date" value="${html(t.plannedDate||'')}" /></label>
        <label class="field">Hora planejada<input id="edit-time" type="time" value="${html(t.plannedTime||'')}" /></label>
        <label class="field">Prazo final<input id="edit-due" type="date" value="${html(t.dueDate||'')}" /></label>
        <label class="field">Agenda Google (.ics)<button class="button" style="margin-top:6px;display:block;width:100%" data-action="export-ics" type="button">↧ Exportar evento</button></label>
      </div>
      <div class="timerbox"><div class="label">◷ TEMPO DE TRABALHO</div><div class="timer-value" data-time="${html(t.id)}">${secondsLabel(sessionSeconds(t))}</div><div class="timer-meta">${active(t)?'● Cronômetro em andamento':'Cronômetro pausado'} · ${len} ${len===1?'sessão':'sessões'} no histórico</div><div class="actionbar">${active(t)?button('Ⅱ Pausar','pause',true):button('▶ Iniciar / retomar','start',true)}${button('✓ Concluir','complete')}${t.gmailUrl?button('↗ Voltar ao Gmail','open-email'):''}</div></div>
      ${titleRow('Subtarefas',`<span class="pill">${t.subtasks.filter(s=>s.done).length}/${t.subtasks.length}</span>`)}${t.subtasks.map(s=>`<label class="subtask ${s.done?'done':''}"><input type="checkbox" data-sub="${html(s.id)}" ${s.done?'checked':''} /><span>${html(s.text)}</span><button class="button small ghost right" type="button" data-delete-sub="${html(s.id)}" aria-label="Excluir subtarefa">✕</button></label>`).join('')||'<div class="muted smalltext" style="margin-top:10px">Ainda não há subtarefas.</div>'}
      <form class="inline-add" id="sub-form"><input name="title" required placeholder="+ Adicionar subtarefa" maxlength="180"/><button class="button small" type="submit">Adicionar</button></form>
      ${origin}<div class="divider"></div>
      <div class="ai-head"><h3 class="sectiontitle">Descrição e assistente Gemini</h3><span class="pill blue">✧ IA</span></div><label class="field">Contexto e anotações<textarea id="edit-description" rows="5" maxlength="7500">${html(t.description)}</textarea></label>
      <div class="ai-control"><select id="ai-mode" aria-label="Tipo de auxílio"><option value="improve" ${view.aiMode==='improve'?'selected':''}>Melhorar descrição</option><option value="reply" ${view.aiMode==='reply'?'selected':''}>Criar resposta ao setor</option><option value="subtasks" ${view.aiMode==='subtasks'?'selected':''}>Sugerir subtarefas</option></select><button type="button" class="button primary" data-action="gemini" ${view.aiLoading?'disabled':''}>${view.aiLoading?'Consultando…':'✧ Gerar com Gemini'}</button></div>
      <div class="smalltext muted" style="margin-top:9px">A descrição é enviada à API Gemini somente quando você clicar no botão. Revise o texto antes de aplicar ou enviar.</div>${result}
      <div class="divider"></div>${titleRow('Histórico do cronômetro')}<div style="margin-top:10px">${history}</div><div class="actionbar" style="justify-content:flex-end">${button('Excluir tarefa','delete-task',false,'') }</div>
    </section>`;
    return pageHead('Minhas tarefas','Capture, planeje, execute e conclua o trabalho em um só lugar.',button('+ Nova tarefa','new-task',true))+`<div class="layout-task">${list}${detail}</div>`;
  }
  function renderProjects(){
    const cards=db.projects.map(p=>{const group=db.tasks.filter(t=>t.project===p.id),closed=group.filter(t=>t.status==='done').length,percent=group.length?Math.round(closed*100/group.length):0;return `<button class="projectcard" data-project="${html(p.id)}"><div class="between"><div class="projecticon" style="background:${p.color}18;color:${p.color}">▦</div><span class="pill">${group.length} tarefas</span></div><strong>${html(p.name)}</strong><p>${group.length-closed} abertas · ${closed} concluídas</p><div class="progressbar"><i style="width:${percent}%;background:${p.color}"></i></div></button>`}).join('');
    const visible=db.tasks.filter(t=>view.projectBoard==='all'||t.project===view.projectBoard);
    const lanes=Object.entries(nameOfStatus).map(([status,title])=>`<div class="lane"><div class="lanehead"><span>${title}</span><span class="pill">${visible.filter(t=>t.status===status).length}</span></div>${visible.filter(t=>t.status===status).map(t=>`<button class="lane-item" data-task="${html(t.id)}"><strong>${html(t.title)}</strong><small>${html(projectName(t.project))} · ${dateLabel(t.dueDate)}</small></button>`).join('')}</div>`).join('');
    return pageHead('Projetos','Organize suas demandas em áreas de trabalho independentes.',button('+ Criar projeto','new-project',true))+`<div class="projectgrid">${cards||'<div class="empty">Nenhum projeto criado.</div>'}</div><div class="card" style="margin-top:19px"><div class="between" style="margin-bottom:16px"><h3 class="sectiontitle">Esteira Kanban</h3><select id="board-filter" class="filterselect" style="max-width:240px" aria-label="Projeto do Kanban">${projOption(view.projectBoard)}</select></div><div class="kanban">${lanes}</div></div>`;
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
    const extensionSetup=`<section class="notice" style="margin-bottom:18px"><b>Incluir no Flow, direto no Gmail</b><p>Instale a extensão no Chrome. Ao abrir uma conversa, clique em <b>Incluir no Flow</b>, escolha uma lista e salve. Suas listas são os projetos deste navegador.</p><a class="button primary" href="./downloads/flow-gmail-extension.zip" download>↓ Baixar extensão para Gmail</a><p class="smalltext" style="margin-bottom:0">Extraia o ZIP. Em chrome://extensions, ative Modo do desenvolvedor, clique em Carregar sem compactação e escolha a pasta flow-gmail. Depois, recarregue o Gmail. O Flow permanece conectado em uma aba de apoio.</p></section>`;
    return pageHead('Gmail + Flow','Cada e-mail vira uma tarefa, sem perder o acesso à conversa original.',button('+ Vincular e-mail','link-email',true))+extensionSetup+`<div class="mailgrid"><section class="card"><div class="between"><h3 class="sectiontitle">Conversas vinculadas</h3><span class="pill">${linked.length}</span></div><div style="margin-top:13px">${linked.map(t=>`<button class="mail-link" data-mail-task="${html(t.id)}"><b>${html(t.gmailSubject||t.title)}</b><small>${html(t.gmailSender||'Gmail')} · ${html(projectName(t.project))}</small></button>`).join('')||'<div class="empty">Nenhuma conversa vinculada. Use a extensão ou o botão de vinculação.</div>'}</div></section><section class="card">${mail?`<div class="eyebrow">E-MAIL DE ORIGEM</div><h2 class="mail-subject">${html(mail.gmailSubject||mail.title)}</h2><p class="smalltext muted">${html(mail.gmailSender||'Remetente não registrado')}</p><div class="divider"></div><p class="smalltext">Esta conversa está associada à tarefa <strong>${html(mail.title)}</strong>.</p><div class="actionbar">${button('↗ Abrir Gmail','open-linked-email',true)}${button('Abrir tarefa no Flow','open-mail-task')}</div>`:`<div class="eyebrow">EXTENSÃO CHROME</div><h2 class="mail-subject">Capture e retorne ao e-mail</h2><p class="smalltext muted">A extensão adiciona o botão Incluir no Flow ao lado do assunto da conversa no Gmail. Escolha a lista na caixa e salve sem sair do e-mail.</p><div class="notice" style="margin-top:16px">A tarefa recebe o assunto, o remetente e o link da conversa. Você pode abrir o e-mail original a partir do Flow.</div>`}</section></div>`;
  }
  function renderAlerts(){
    const rows=[['Lembrar antes do vencimento','Planejado para a etapa de envio de e-mails.'],['Acompanhar tarefas atrasadas','Alerta para tarefas cujo prazo final já passou.'],['Resumo diário de tarefas','Consolidar as demandas previstas para cada dia.'],['Resumo semanal por projeto','Entregar um resumo de pendências por projeto.']];
    return pageHead('Alertas','Preferências de lembretes e acompanhamento.')+`<section class="card">${rows.map(([title,desc],i)=>`<div class="alertrow"><div><strong>${title}</strong><small>${desc}</small></div><button class="switch ${db.preferences.alerts[i]?'on':''}" data-alert="${i}" role="switch" aria-checked="${db.preferences.alerts[i]}" aria-label="${title}"></button></div>`).join('')}<label class="field" style="max-width:310px;margin-top:19px">Antecedência do lembrete<select id="reminder-days">${[1,2,3,7].map(n=>`<option value="${n}" ${db.preferences.reminderDays===n?'selected':''}>${n} ${n===1?'dia':'dias'} antes</option>`).join('')}</select></label></section><div class="notice" style="margin-top:15px">Esta tela já grava suas preferências. O envio automático por e-mail <b>ainda não está ativado</b>; ele dependerá da autenticação, do servidor e do serviço de notificações.</div>`;
  }
  function tick(){const running=runningTask();const el=$('#active-clock');if(el){el.classList.toggle('running',!!running);el.textContent=running?`● ${secondsLabel(sessionSeconds(running))} · ${running.title}`:'◷ Nenhum cronômetro ativo'}document.querySelectorAll('[data-time]').forEach(x=>{const t=findTask(x.dataset.time);if(t)x.textContent=secondsLabel(sessionSeconds(t))})}
  function render(){const names={tarefas:'Tarefas',projetos:'Projetos',agenda:'Agenda',gmail:'Gmail',alertas:'Alertas'};$('#location-label').textContent=names[view.page];document.querySelectorAll('#sidebar-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===view.page));$('#screen').innerHTML=({tarefas:renderTasks,projetos:renderProjects,agenda:renderCalendar,gmail:renderGmail,alertas:renderAlerts})[view.page]();tick()}
  function stop(t){if(!t?.startedAt)return;const now=Date.now();const latest=t.sessions?.[t.sessions.length-1];if(latest && latest.start===t.startedAt && !latest.end)latest.end=now;else t.sessions.push({start:t.startedAt,end:now});t.startedAt=null}
  function start(t){if(!t)return;for(const running of db.tasks.filter(active)){if(running.id!==t.id)stop(running)}if(!t.startedAt){t.startedAt=Date.now();t.sessions.push({start:t.startedAt,end:null});t.status='doing'}persistAndRender();notice('Cronômetro iniciado. Ele continuará contando mesmo ao fechar esta aba.')}
  function complete(t){stop(t);t.status='done';t.completedAt=Date.now();persistAndRender();notice('Tarefa concluída. Sessões de trabalho registradas.')}
  function openPage(page){if(!['tarefas','projetos','agenda','gmail','alertas'].includes(page))return;view.page=page;view.aiSuggestion=null;render();document.querySelector('.screen').scrollTo(0,0)}
  function selectTask(id){view.selectedId=id;view.projectFilter='all';view.statusFilter='all';openPage('tarefas')}
  function openGmail(t){const url=validGmailUrl(t?.gmailUrl);if(!url){notice('Não há um link válido do Gmail nesta tarefa.');return}window.open(url,'_blank','noopener,noreferrer')}
  function download(filename, content, type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportIcs(t){if(!t?.plannedDate){notice('Informe a data de execução antes de exportar o evento.');return}const d=t.plannedDate.replaceAll('-','');let start='',end='';if(t.plannedTime){const dt=new Date(`${t.plannedDate}T${t.plannedTime}:00`);start=`DTSTART:${dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;end=`DTEND:${new Date(dt.getTime()+30*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`}else{const next=new Date(`${t.plannedDate}T12:00:00`);next.setDate(next.getDate()+1);start=`DTSTART;VALUE=DATE:${d}`;end=`DTEND;VALUE=DATE:${localDate(next).replaceAll('-','')}`}const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flow Workspace//PT-BR//EN','BEGIN:VEVENT',`UID:${t.id}@flow.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,start,end,`SUMMARY:${escapeIcs(t.title)}`,`DESCRIPTION:${escapeIcs(t.description+(t.gmailUrl?'\nGmail: '+t.gmailUrl:''))}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');download(`flow-${t.id}.ics`,text,'text/calendar;charset=utf-8');notice('Evento .ics exportado. Importe o arquivo no Google Agenda.')}
  function promptModal({title,subtitle,content,onSubmit,ok='Salvar'}){
    const box=$('#modal-backdrop');box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${html(title)}"><h2>${html(title)}</h2><p>${html(subtitle)}</p><form id="active-modal-form">${content}<div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">${html(ok)}</button></div></form></div>`;box.classList.remove('hidden');box._submit=onSubmit;box.querySelector('input,select')?.focus();
  }
  const closeModal=()=>{$('#modal-backdrop').classList.add('hidden');$('#modal-backdrop').innerHTML=''};
  function newProject(){promptModal({title:'Novo projeto',subtitle:'Organize suas demandas em uma nova área.',content:`<label class="field">Nome do projeto<input name="name" required maxlength="70" placeholder="Ex.: Planejamento Acadêmico" /></label><label class="field">Cor<select name="color"><option value="#507ee9">Azul</option><option value="#9270d4">Violeta</option><option value="#2ca79a">Verde</option><option value="#dbab56">Dourado</option></select></label>`,onSubmit:data=>{const name=String(data.get('name')||'').trim();if(!name)return false;db.projects.push({id:uuid(),name,color:String(data.get('color'))});persistAndRender();notice('Projeto criado.');return true}})}
  function newTask(prefill={}){
    const isMail=!!prefill.gmailUrl;
    const content=`<label class="field">Título da tarefa<input name="title" required maxlength="180" value="${html(prefill.title||'')}" placeholder="Ex.: Responder à coordenação" /></label><label class="field">Projeto<select name="project">${projOption(prefill.project||db.projects[0]?.id,false)}</select></label><div class="form-grid"><label class="field">Executar em<input type="date" name="plannedDate" value="${html(prefill.plannedDate||addDays(1))}" /></label><label class="field">Prazo final<input type="date" name="dueDate" value="${html(prefill.dueDate||addDays(4))}" /></label></div><label class="field">Descrição<textarea name="description" rows="3" maxlength="7500">${html(prefill.description||'')}</textarea></label>${isMail?`<div class="notice" style="margin-top:13px">✉ Link capturado do Gmail: ${html(prefill.gmailSubject||prefill.gmailUrl)}</div>`:''}`;
    promptModal({title:isMail?'Criar tarefa do Gmail':'Nova tarefa',subtitle:isMail?'Associe esta conversa a um projeto e escolha quando resolver.':'Crie uma demanda e organize seu trabalho.',content,onSubmit:data=>{const title=String(data.get('title')||'').trim();if(!title)return false;const t={id:uuid(),title,project:String(data.get('project')),status:'todo',priority:'medium',plannedDate:String(data.get('plannedDate')||''),plannedTime:'',dueDate:String(data.get('dueDate')||''),description:String(data.get('description')||''),subtasks:[],sessions:[],startedAt:null,gmailUrl:validGmailUrl(prefill.gmailUrl||''),gmailSubject:String(prefill.gmailSubject||''),gmailSender:String(prefill.gmailSender||''),createdAt:Date.now(),completedAt:null};db.tasks.unshift(t);view.selectedId=t.id;view.projectFilter='all';view.statusFilter='all';openPage('tarefas');persist();notice('Tarefa criada no Flow.');return true},ok:'Criar tarefa'});
  }
  function linkMail(){promptModal({title:'Vincular conversa do Gmail',subtitle:'Cole o link da conversa e associe a uma nova tarefa.',content:`<label class="field">Link da conversa<input name="url" type="url" required placeholder="https://mail.google.com/mail/u/0/#..." /></label><label class="field">Assunto<input name="subject" required maxlength="180" placeholder="Assunto do e-mail" /></label><label class="field">Remetente (opcional)<input name="sender" maxlength="150" placeholder="Setor responsável" /></label>`,onSubmit:data=>{const gmailUrl=validGmailUrl(String(data.get('url')));if(!gmailUrl){notice('Cole um endereço HTTPS válido de mail.google.com.');return false}const gmailSubject=String(data.get('subject')||'').trim();const gmailSender=String(data.get('sender')||'').trim();newTask({title:`Responder: ${gmailSubject}`,gmailUrl,gmailSubject,gmailSender});return false},ok:'Continuar'})}
  function exportData(){download(`flow-backup-${localDate()}.json`,JSON.stringify(db,null,2),'application/json');notice('Cópia de segurança exportada.')}
  function importData(){promptModal({title:'Importar backup',subtitle:'Atenção: esta operação substitui todos os dados deste navegador.',content:`<label class="field">Arquivo JSON do Flow<input name="file" type="file" accept=".json,application/json" required /></label>`,onSubmit:()=>false,ok:'Importar'});const form=$('#active-modal-form');form.addEventListener('submit',async e=>{e.preventDefault();const file=form.elements.file.files?.[0];if(!file)return;try{const val=JSON.parse(await file.text());if(val?.version!==1||!Array.isArray(val.projects)||!Array.isArray(val.tasks))throw new Error();if(!confirm('Substituir todas as tarefas e projetos atuais pelo backup?'))return;db=val;view.selectedId=db.tasks[0]?.id||null;persist();closeModal();render();notice('Backup importado com sucesso.')}catch{notice('Backup inválido ou incompatível.')}},{once:true})}
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
      case 'open-active':if(runningTask())selectTask(runningTask().id);else notice('Nenhum cronômetro está ativo.');break;
      case 'start':start(t);break;
      case 'pause':stop(t);persistAndRender();notice('Cronômetro pausado.');break;
      case 'complete':complete(t);break;
      case 'delete-task':if(confirm('Excluir a tarefa e todo seu histórico de tempo?')){stop(t);db.tasks=db.tasks.filter(x=>x.id!==t.id);view.selectedId=db.tasks[0]?.id||null;persistAndRender();notice('Tarefa excluída.')}break;
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
    if(x.dataset.sub){const sub=t.subtasks.find(s=>s.id===x.dataset.sub);if(sub){sub.done=x.checked;persistAndRender()}return}
    if(x.id==='filter-project'){view.projectFilter=x.value;render();return}
    if(x.id==='filter-status'){view.statusFilter=x.value;render();return}
    if(x.id==='board-filter'){view.projectBoard=x.value;render();return}
    if(x.id==='ai-mode'){view.aiMode=x.value;view.aiSuggestion=null;render();return}
    if(x.id==='reminder-days'){db.preferences.reminderDays=Number(x.value);persist();return}
    const fieldMap={'edit-title':'title','edit-project':'project','edit-status':'status','edit-priority':'priority','edit-planned':'plannedDate','edit-time':'plannedTime','edit-due':'dueDate','edit-description':'description'};
    if(fieldMap[x.id] && t){const field=fieldMap[x.id];if(field==='status'&&x.value==='done'){stop(t);t.completedAt=Date.now()}if(field==='status'&&t.status==='done'&&x.value!=='done')t.completedAt=null;t[field]=x.value;persistAndRender()}
  });
  document.addEventListener('input',e=>{if(e.target.id==='edit-description'){const t=selectedTask();if(t){t.description=e.target.value;persist()}}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY){db=load();render()}});
  // Atualiza os rótulos; a contagem decorre dos timestamps, não da frequência do setInterval.
  setInterval(tick,1000);
  // Botão de backup facilmente acessível sem ocupar uma sexta tela.
  const nav=document.querySelector('.sidebar-foot');const backup=document.createElement('button');backup.className='button small';backup.type='button';backup.dataset.action='settings';backup.title='Exportar ou importar os dados';backup.style.cssText='margin-left:auto;padding:5px 7px;background:#314b74;border-color:#48618a;color:#d5e3fd';backup.textContent='⚙';nav.appendChild(backup);
  persist();render();handleCapture();
})();
