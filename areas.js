/* Destinos de classificação definidos pelo usuário. */
(() => {
  'use strict';
  const version = 5;
  const catalog = [
    {id:'ubra-ia', name:'Ubra IA', color:'#507ee9'},
    {id:'oferta', name:'Oferta de turmas', color:'#507ee9'},
    {id:'carga', name:'Carga horária docente', color:'#9270d4'},
    {id:'incidencias', name:'Incidências em folha', color:'#ca8265'},
    {id:'pj', name:'Contratos docentes PJ', color:'#ca8265', aliases:['Contratos PJ','Contrato docente PJ']},
    {id:'folha', name:'Folha docente', color:'#418d9d'},
    {id:'plano', name:'Plano docente', color:'#9270d4'},
    {id:'lato-sensu', name:'Operação Lato Sensu Ulbra S.A.', color:'#2ca79a', aliases:['Operação lato sensu BreCIA']},
    {id:'pagamentos-pj', name:'Pendências de pagamento PJ', color:'#dbab56'},
    {id:'suporte', name:'Suporte operacional', color:'#507ee9'},
    {id:'cpa', name:'CPA Ulbra S.A.', color:'#2ca79a', aliases:['CPA / Avaliação','CPA Ubrecia']},
    {id:'capacitacao', name:'Capacitação', color:'#9270d4'}
  ].map(area => Object.freeze({...area, aliases:Object.freeze(area.aliases||[])}));
  const nameKey = name => String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
  const defaults = () => catalog.map(({id,name,color})=>({id,name,color}));
  const isArea = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  // Dados malformados não derrubam a abertura nem somem: o que não é área vai para db.recovered.
  function keep(db, key) {
    const value = db[key];
    if (key === 'archivedProjects' && value == null) return;
    if (Array.isArray(value) && value.every(isArea)) return;
    const recover = record => {
      if (!Array.isArray(db.recovered)) db.recovered = db.recovered == null ? [] : [{from:'recovered', value:db.recovered}];
      db.recovered.push(record);
    };
    if (Array.isArray(value)) value.forEach((item,index)=>{if(!isArea(item))recover({from:key,index,value:item})});
    else if (value != null) recover({from:key,value});
    db[key] = Array.isArray(value) ? value.filter(isArea) : [];
  }

  function migrate(db) {
    if (!isArea(db)) return db;
    keep(db,'projects'); keep(db,'archivedProjects');
    if (db.classificationCatalogVersion >= version) return db;
    const retired = db.projects.filter(area=>['ubra s.a.','ubracis'].includes(nameKey(area.name)));
    if(retired.length){
      db.archivedProjects ||= [];
      for(const area of retired)if(!db.archivedProjects.some(item=>item.id===area.id))db.archivedProjects.push({...area});
      const ids=new Set(retired.map(area=>area.id));db.projects=db.projects.filter(area=>!ids.has(area.id));
    }
    if (db.classificationCatalogVersion >= 1) {
      // Corrige a grafia sem recriar categorias removidas ou alterar vínculos.
      for (const area of [...db.projects,...(db.archivedProjects||[])]) {
        if (db.classificationCatalogVersion===1 && nameKey(area.name)==='ubracis') area.name='Ubra S.A.';
        if (nameKey(area.name)===nameKey('CPA Ubrecia')) area.name='CPA Ulbra S.A.';
        if (nameKey(area.name)===nameKey('Operação lato sensu BreCIA')) area.name='Operação Lato Sensu Ulbra S.A.';
      }
      db.classificationCatalogVersion = version;
      return db;
    }
    const existing = [...db.projects];
    const used = new Set();
    const ids = new Set([...existing, ...(db.archivedProjects||[])].map(area=>area.id));
    const projects = catalog.map(definition => {
      const names = [definition.name,...definition.aliases].map(nameKey);
      const candidates = existing.filter(area=>!used.has(area.id)&&names.includes(nameKey(area.name)));
      const match = candidates.find(area=>area.id===definition.id)||candidates[0];
      if (match) {
        used.add(match.id);
        return {...match,name:definition.name};
      }
      let id=definition.id, suffix=1;
      while(ids.has(id)) id=`${definition.id}-${suffix++}`;
      ids.add(id);
      return {id,name:definition.name,color:definition.color};
    });
    const archived = [...(db.archivedProjects||[])];
    for (const area of existing.filter(area=>!used.has(area.id))) {
      // A área de exemplo retirada da lista permanece disponível no histórico.
      if (area.id==='ouv' && nameKey(area.name)==='ouvidoria') {
        if (!archived.some(item=>item.id===area.id)) archived.push(area);
      } else projects.push(area); // Áreas personalizadas não são apagadas.
    }
    db.projects = projects;
    if (archived.length) db.archivedProjects = archived;
    db.classificationCatalogVersion = version;
    return db;
  }
  globalThis.FlowAreas = Object.freeze({version,catalog:Object.freeze(catalog),defaults,migrate});
})();
