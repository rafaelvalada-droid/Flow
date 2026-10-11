/* PDF local: nenhum dado do relatório é enviado a um serviço externo. */
(() => {
  'use strict';
  let library;
  function loadLibrary() {
    if (globalThis.jspdf) return Promise.resolve(globalThis.jspdf.jsPDF);
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/jspdf.umd.min.js';
      script.onload = () => resolve(globalThis.jspdf.jsPDF);
      script.onerror = () => { library = null; script.remove(); reject(new Error('Não foi possível carregar o gerador de PDF. Tente novamente.')); };
      document.head.append(script);
    });
    return library;
  }
  async function image(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Não foi possível carregar os logos do relatório.');
    return new Uint8Array(await response.arrayBuffer());
  }
  async function download(report, period) {
    const [PDF, flow, ulbra, regular, bold] = await Promise.all([loadLibrary(), image('./assets/flow-mark-green.png'), image('./assets/ulbra-sa-verde.png'), image('./assets/fonts/DejaVuSans.ttf'), image('./assets/fonts/DejaVuSans-Bold.ttf')]);
    const doc = new PDF({unit: 'mm', format: 'a4', compress: true});
    const encode = bytes => {let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);};
    doc.addFileToVFS('FlowSans.ttf',encode(regular));doc.addFont('FlowSans.ttf','FlowSans','normal');
    doc.addFileToVFS('FlowSans-Bold.ttf',encode(bold));doc.addFont('FlowSans-Bold.ttf','FlowSans','bold');
    const green = [4,90,82], ink = [45,54,61], muted = [91,105,112], pale = [236,242,240];
    const duration = FlowTime.duration;
    const date = value => new Date(value).toLocaleDateString('pt-BR');
    const last = new Date(report.end); last.setDate(last.getDate()-1);
    const range = date(report.start) + (period === 'day' ? '' : ' a ' + date(last));
    const clean = value => String(value ?? '').replace(/[\u0000-\u001f]/g,' ').replace(/[–—]/g,'-');
    let y = 47;
    function text(value, x, top, size = 10, color = ink, bold = false) {
      doc.setFont('FlowSans', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
      doc.text(clean(value), x, top);
    }
    function lines(value, width, size = 9) {
      doc.setFont('FlowSans','normal'); doc.setFontSize(size);
      return doc.splitTextToSize(clean(value), width);
    }
    function header() {
      doc.setFillColor(...pale); doc.rect(0,0,210,30,'F');
      doc.setFillColor(...green); doc.rect(0,29,210,1,'F');
      doc.addImage(flow,'PNG',16,6,17,17); text('flow.',36,18,22,green,true);
      doc.addImage(ulbra,'PNG',145,9,49,14.1);
      text('GESTÃO DO TEMPO',16,39,9,green,true); text(range,130,39,9,muted);
    }
    function space(height) { if (y+height > 273) {doc.addPage(); header(); y=49;} }
    function section(title) { space(15); text(title,16,y,13,green,true); y+=9; }
    function paragraph(value) { const wrapped=lines(value,178);space(wrapped.length*4.5+5);wrappedText(wrapped,16,y,9,muted);y+=wrapped.length*4.5+5; }
    // Arrays are intentionally passed directly to jsPDF for wrapped lines.
    function wrappedText(value, x, top, size=9, color=ink) {
      doc.setFont('FlowSans','normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(value,x,top);
    }
    header();
    text('Seu tempo, em perspectiva.',16,y,22,ink,true); y+=10;
    text('Relatório '+({day:'diário',week:'semanal',month:'mensal'}[period]||''),16,y,11,muted);y+=12;
    const topArea=report.areas[0];
    for (const [i,label,value] of [[0,'TEMPO TRABALHADO',duration(report.totalMs)],[1,'TAREFAS',String(report.tasks.length)],[2,'SESSÕES',String(report.sessionCount)]]) {
      const x=16+i*61;doc.setFillColor(...pale);doc.roundedRect(x,y,56,25,3,3,'F');text(label,x+5,y+8,8,muted,true);text(value,x+5,y+19,19,green,true);
    }
    y+=31;
    section(period==='day'?'Ritmo do dia':'Ritmo do período');
    const peak=Math.max(...report.buckets.map(b=>b.ms),1), step=178/Math.max(report.buckets.length,1), baseline=y+30;
    doc.setDrawColor(210,219,216);doc.line(16,baseline,194,baseline);
    report.buckets.forEach((bucket,i)=>{
      const h=bucket.ms/peak*24;doc.setFillColor(...green);if(h)doc.roundedRect(16+i*step+1,baseline-h,Math.max(1,step-2),h,.6,.6,'F');
      if(report.buckets.length<=10 || i%4===0 || i===report.buckets.length-1)text(bucket.label,16+i*step+1,baseline+5,7,muted);
    });
    text('Maior registro: '+duration(peak===1?0:peak),16,y,8,muted);y=baseline+12;
    section('Distribuição por área');
    if (!topArea) paragraph('Nenhum tempo registrado neste período. Inicie uma sessão de foco para acompanhar seu trabalho.');
    for(const area of report.areas){
      const title=lines(area.name,125);const height=title.length*4+13;space(height);
      wrappedText(title,16,y);text(duration(area.ms)+'  |  '+Math.round(area.ms/(report.totalMs||1)*100)+'%',155,y,9,green,true);
      y+=title.length*4;doc.setFillColor(...pale);doc.roundedRect(16,y,178,3,1,1,'F');doc.setFillColor(...green);
      if(area.ms)doc.roundedRect(16,y,Math.max(1,178*area.ms/(report.totalMs||1)),3,1,1,'F');y+=6;
    }
    section('Detalhamento por tarefa');
    function tableHeader(){space(12);doc.setFillColor(...pale);doc.rect(16,y-4,178,9,'F');text('TAREFA / ÁREA',19,y+2,8,muted,true);text('TEMPO',150,y+2,8,muted,true);text('SESSÕES',177,y+2,8,muted,true);y+=12;}
    tableHeader();
    for(const task of report.tasks){
      const title=lines(task.title,125,9),area=lines(task.area,125,8);
      let offset=0; const all=[...title,...area];
      while(offset<all.length){
        const available=Math.floor((273-y-8)/4);
        if(available<2){doc.addPage();header();y=49;tableHeader();continue;}
        const chunk=all.slice(offset,offset+available);
        wrappedText(chunk,19,y,9);
        if(offset===0){text(duration(task.ms),150,y,9,green,true);text(String(task.sessions),180,y,9,muted);}
        y+=chunk.length*4+6;offset+=chunk.length;
        doc.setDrawColor(222,228,226);doc.line(16,y-2,194,y-2);
      }
    }
    if(!report.tasks.length)paragraph('Nenhuma tarefa com sessões de trabalho neste período.');
    y+=3;
    const note=lines('Somente tempo trabalhado; pausas não entram nos totais. Sessões que atravessam a meia-noite são divididas entre os dias. Fuso: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'. Áreas correspondem à classificação atual das tarefas.',178,8);
    space(note.length*4+2);wrappedText(note,16,y,8,muted);
    const total=doc.getNumberOfPages(), generated=new Date().toLocaleString('pt-BR');
    for(let page=1;page<=total;page++){doc.setPage(page);doc.setDrawColor(222,228,226);doc.line(16,282,194,282);text('Flow • Gerado em '+generated,16,288,8,muted);text(page+' / '+total,182,288,8,muted);}
    doc.setProperties({title:'Flow - Gestão do Tempo - '+range,subject:'Tempo trabalhado por área e tarefa',creator:'Flow',author:'Flow'});
    doc.save('flow-tempo-'+period+'-'+report.start.getFullYear()+'-'+String(report.start.getMonth()+1).padStart(2,'0')+'-'+String(report.start.getDate()).padStart(2,'0')+'.pdf');
  }
  globalThis.FlowPDF={download};
})();
