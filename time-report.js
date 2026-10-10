(() => {
  'use strict';
  const stamp = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function range(period = 'week', offset = 0, now = new Date()) {
    const start = new Date(now); start.setHours(0,0,0,0);
    if (period === 'month') {start.setDate(1);start.setMonth(start.getMonth()+offset);}
    else if (period === 'week') start.setDate(start.getDate()-(start.getDay()+6)%7+offset*7);
    else start.setDate(start.getDate()+offset);
    const end = new Date(start);
    if (period === 'month') end.setMonth(end.getMonth()+1);
    else end.setDate(end.getDate()+(period === 'week'?7:1));
    return {start, end};
  }
  function summarize(db, period = 'week', offset = 0, now = Date.now()) {
    const {start,end} = range(period, offset, new Date(now)), buckets = [];
    let cursor = new Date(start);
    while (cursor < end) {
      const from = new Date(cursor), until = new Date(cursor);
      if (period === 'day') until.setHours(until.getHours()+1); else until.setDate(until.getDate()+1);
      buckets.push({start: +from, end: +until, label: period==='day'?`${String(from.getHours()).padStart(2,'0')}h`:period==='week'?from.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''):String(from.getDate()), ms: 0});
      cursor = until;
    }
    const areas = new Map(), tasks = [];
    let totalMs = 0, sessionCount = 0;
    for (const task of db.tasks) {
      let ms = 0, count = 0;
      for (const session of task.sessions || []) {
        const from = Number(session.start);
        const until = session.end == null ? Math.min(now, db.focus?.taskId===task.id && db.focus?.phase==='work' && db.focus.endsAt ? db.focus.endsAt : now) : Math.min(Number(session.end), now);
        if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) continue;
        const clippedStart = Math.max(from, +start), clippedEnd = Math.min(until, +end);
        if (clippedEnd <= clippedStart) continue;
        ms += clippedEnd-clippedStart; count++;
        for (const bucket of buckets) bucket.ms += Math.max(0, Math.min(clippedEnd,bucket.end)-Math.max(clippedStart,bucket.start));
      }
      if (!ms) continue;
      const project = [...db.projects, ...(db.archivedProjects || [])].find(p=>p.id===task.project);
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
    const end=new Date(report.end);end.setDate(end.getDate()-1);
    const rows=[['Relatório Flow','Gestão do Tempo'],['Período',stamp(report.start),stamp(end)],
      ['Tempo total',duration(report.totalMs),'Segundos',Math.floor(report.totalMs/1000)],[],
      ['Área','Tempo trabalhado','Segundos','Tarefas com tempo']];
    for (const area of report.areas) rows.push([area.name,duration(area.ms),Math.floor(area.ms/1000),area.tasks]);
    rows.push([],['Tarefa','Área','Tempo trabalhado','Segundos','Sessões no período']);
    for (const task of report.tasks) rows.push([task.title,task.area,duration(task.ms),Math.floor(task.ms/1000),task.sessions]);
    return '\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
  }
  globalThis.FlowTime = {range,summarize,duration,csv};
})();
