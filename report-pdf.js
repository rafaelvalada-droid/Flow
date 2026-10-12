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
  const resources=new Map();
  function image(path){
    if(!resources.has(path))resources.set(path,(async()=>{
      const response=await fetch(path,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Não foi possível carregar os recursos do relatório.');
      return new Uint8Array(await response.arrayBuffer());
    })().catch(error=>{resources.delete(path);throw error;}));
    return resources.get(path);
  }
  async function download(report, period) {
    const [PDF, flow, ulbra, regular, bold] = await Promise.all([loadLibrary(), image('./assets/uflow-logo.png'), image('./assets/ulbra-sa-verde.png'), image('./assets/fonts/DejaVuSans.ttf'), image('./assets/fonts/DejaVuSans-Bold.ttf')]);
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
    let y = 44;
    function text(value, x, top, size = 8, color = ink, bold = false) {
      doc.setFont('FlowSans', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
      doc.text(clean(value), x, top);
    }
    function lines(value, width, size = 8) {
      doc.setFont('FlowSans','normal'); doc.setFontSize(size);
      return doc.splitTextToSize(clean(value), width);
    }
    function header() {
      doc.setFillColor(...pale); doc.rect(0,0,210,30,'F');
      doc.setFillColor(...green); doc.rect(0,29,210,1,'F');
      doc.addImage(flow,'PNG',16,7,16,16);text('Ulbra',36,18,20,green,true);const wordWidth=doc.getTextWidth('Ulbra');text('flow',36+wordWidth,18,20,[251,182,64],true);
      doc.addImage(ulbra,'PNG',145,9,49,14.1);
      text('GESTÃO DO TEMPO',16,38,8,green,true); text(range,130,38,8,muted);
    }
    function space(height) { if (y+height > 273) {doc.addPage(); header(); y=44;} }
    function section(title) { y+=4;space(15); text(title,16,y,10,green,true); y+=7; }
    function paragraph(value) { const wrapped=lines(value,178);space(wrapped.length*4.5+5);wrappedText(wrapped,16,y,9,muted);y+=wrapped.length*4.5+5; }
    // Arrays are intentionally passed directly to jsPDF for wrapped lines.
    function wrappedText(value, x, top, size=8, color=ink) {
      doc.setFont('FlowSans','normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(value,x,top);
    }
    header();
    text('Relatório de tempo',16,y,16,ink,true); y+=7;
    text('Relatório '+({day:'diário',week:'semanal',month:'mensal'}[period]||''),16,y,8,muted);y+=9;
    const topArea=report.areas[0];
    for (const [i,label,value] of [[0,'TEMPO TRABALHADO',duration(report.totalMs)],[1,'TAREFAS',String(report.tasks.length)],[2,'SESSÕES',String(report.sessionCount)]]) {
      const x=16+i*61;doc.setFillColor(...pale);doc.roundedRect(x,y,56,21,2,2,'F');text(label,x+5,y+7,7,muted,true);text(value,x+5,y+16,14,green,true);
    }
    y+=27;
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
      const title=lines(area.name,125);const height=title.length*3.5+10;space(height);
      wrappedText(title,16,y);text(duration(area.ms)+'  |  '+Math.round(area.ms/(report.totalMs||1)*100)+'%',155,y,8,green,true);
      y+=title.length*3.5;doc.setFillColor(...pale);doc.roundedRect(16,y,178,3,1,1,'F');doc.setFillColor(...green);
      if(area.ms)doc.roundedRect(16,y,Math.max(1,178*area.ms/(report.totalMs||1)),3,1,1,'F');y+=6;
    }
    section('Detalhamento por tarefa');
    function tableHeader(){space(12);doc.setFillColor(...pale);doc.rect(16,y-4,178,9,'F');text('TAREFA / ÁREA',19,y+2,8,muted,true);text('TEMPO',150,y+2,8,muted,true);text('SESSÕES',177,y+2,8,muted,true);y+=12;}
    tableHeader();
    for(const task of report.tasks){
      const title=lines(task.title,120,8),area=lines(task.area,120,7);
      const all=[...title.map(value=>({value,size:8,color:ink})),...area.map(value=>({value,size:7,color:muted}))];
      let offset=0;
      // Keep ordinary rows together; split only rows too tall for a full page.
      if(all.length*3.5+5<=210&&y+all.length*3.5+5>273){doc.addPage();header();y=44;tableHeader();}
      while(offset<all.length){
        const available=Math.floor((273-y-5)/3.5);
        if(available<2){doc.addPage();header();y=44;tableHeader();continue;}
        const chunk=all.slice(offset,offset+available);
        chunk.forEach((line,i)=>text(line.value,19,y+i*3.5,line.size,line.color));
        if(offset===0){text(duration(task.ms),150,y,8,green,true);text(String(task.sessions),180,y,8,muted);}
        y+=chunk.length*3.5+5;offset+=chunk.length;
        doc.setDrawColor(222,228,226);doc.line(16,y-2,194,y-2);
      }
    }
    if(!report.tasks.length)paragraph('Nenhuma tarefa com sessões de trabalho neste período.');
    y+=3;
    const note=lines('Somente tempo trabalhado; pausas não entram nos totais. Sessões que atravessam a meia-noite são divididas entre os dias. Fuso: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'. Áreas correspondem à classificação atual das tarefas.',178,7);
    space(note.length*3.5+2);wrappedText(note,16,y,7,muted);
    const total=doc.getNumberOfPages(), generated=new Date().toLocaleString('pt-BR');
    for(let page=1;page<=total;page++){doc.setPage(page);doc.setDrawColor(222,228,226);doc.line(16,282,194,282);text('Ulbraflow • Gerado em '+generated,16,288,7,muted);text(page+' / '+total,182,288,7,muted);}
    doc.setProperties({title:'Ulbraflow - Gestão do Tempo - '+range,subject:'Tempo trabalhado por área e tarefa',creator:'Ulbraflow',author:'Ulbraflow'});
    doc.save('ulbraflow-tempo-'+period+'-'+report.start.getFullYear()+'-'+String(report.start.getMonth()+1).padStart(2,'0')+'-'+String(report.start.getDate()).padStart(2,'0')+'.pdf');
  }
  globalThis.FlowPDF={download};
})();
