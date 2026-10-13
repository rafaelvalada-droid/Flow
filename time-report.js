(() => {
  'use strict';
  const stamp = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  // Limites por partes da data: em fusos com horário de verão à meia-noite (America/Santiago, Havana,
  // regras antigas de Sao_Paulo) o dia começa às 01:00, e copiar a hora do início deslocaria os dias seguintes.
  function range(period = 'week', offset = 0, now = new Date()) {
    const year = now.getFullYear(), month = now.getMonth();
    if (period === 'month') return {start: new Date(year, month+offset, 1), end: new Date(year, month+offset+1, 1)};
    const day = now.getDate() + (period === 'week' ? 7*offset - (now.getDay()+6)%7 : offset);
    return {start: new Date(year, month, day), end: new Date(year, month, day + (period === 'week' ? 7 : 1))};
  }
  function summarize(db, period = 'week', offset = 0, now = Date.now()) {
    const {start,end} = range(period, offset, new Date(now)), buckets = [];
    const year = start.getFullYear(), month = start.getMonth(), day = start.getDate();
    const edge = index => period === 'day' ? new Date(year, month, day, index) : new Date(year, month, day+index);
    for (let index = 0; edge(index) < end; index++) {
      const from = edge(index), until = new Date(Math.min(+edge(index+1), +end));
      if (until <= from) continue; // Hora inexistente no início do horário de verão.
      buckets.push({start: +from, end: +until, label: period==='day'?`${String(from.getHours()).padStart(2,'0')}h`:period==='week'?from.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''):String(from.getDate()), ms: 0});
    }
    const areas = new Map(), tasks = [];
    const catalog = [...(Array.isArray(db.projects) ? db.projects : []), ...(Array.isArray(db.archivedProjects) ? db.archivedProjects : [])];
    let totalMs = 0, sessionCount = 0;
    for (const task of Array.isArray(db.tasks) ? db.tasks : []) {
      let ms = 0, count = 0;
      for (const session of Array.isArray(task?.sessions) ? task.sessions : []) {
        if (!session || typeof session !== 'object') continue;
        const from = Number(session.start);
        const until = session.end == null ? Math.min(now, db.focus?.taskId===task.id && db.focus?.phase==='work' && db.focus.endsAt ? db.focus.endsAt : now) : Math.min(Number(session.end), now);
        if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) continue;
        const clippedStart = Math.max(from, +start), clippedEnd = Math.min(until, +end);
        if (clippedEnd <= clippedStart) continue;
        ms += clippedEnd-clippedStart; count++;
        for (const bucket of buckets) bucket.ms += Math.max(0, Math.min(clippedEnd,bucket.end)-Math.max(clippedStart,bucket.start));
      }
      if (!ms) continue;
      const project = catalog.find(p=>p?.id===task.project);
      const area = project?.name || 'Sem área', areaId = project?.id || '';
      const row = areas.get(areaId) || {id:areaId, name:area, color:project?.color || '#8998ae', ms:0, tasks:0};
      row.ms += ms; row.tasks++; areas.set(areaId, row);
      tasks.push({id:task.id,title:task.title,area,ms,sessions:count});
      totalMs += ms; sessionCount += count;
    }
    const activeDays = new Set(buckets.filter(b=>b.ms).map(b=>stamp(new Date(b.start)))).size;
    return {period,start,end,buckets,totalMs,sessionCount,activeDays,
      areas:[...areas.values()].sort((a,b)=>b.ms-a.ms),tasks:tasks.sort((a,b)=>b.ms-a.ms)};
  }
  const duration = ms => {const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');};
  const cell = value => {
    let text=String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  function csv(report) {
    const end=new Date(+report.end-1); // Último instante do período, mesmo sem meia-noite local.
    const rows=[['Relatório UlbraFlow','Gestão do Tempo'],['Período',stamp(report.start),stamp(end)],
      ['Tempo total',duration(report.totalMs),'Segundos',Math.floor(report.totalMs/1000)],[],
      ['Área','Tempo trabalhado','Segundos','Tarefas com tempo']];
    for (const area of report.areas) rows.push([area.name,duration(area.ms),Math.floor(area.ms/1000),area.tasks]);
    rows.push([],['Tarefa','Área','Tempo trabalhado','Segundos','Sessões no período']);
    for (const task of report.tasks) rows.push([task.title,task.area,duration(task.ms),Math.floor(task.ms/1000),task.sessions]);
    return '\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
  }
  globalThis.FlowTime = {range,summarize,duration,csv};
})();
