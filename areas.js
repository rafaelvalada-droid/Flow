/* Destinos de classificação definidos pelo usuário. */
(() => {
  'use strict';
  const version = 1;
  const catalog = [
    {id:'ubra-ia', name:'Ubra IA', color:'#507ee9'},
    {id:'oferta', name:'Oferta de turmas', color:'#507ee9'},
    {id:'carga', name:'Carga horária docente', color:'#9270d4'},
    {id:'incidencias', name:'Incidências em folha', color:'#ca8265'},
    {id:'pj', name:'Contratos docentes PJ', color:'#ca8265', aliases:['Contratos PJ','Contrato docente PJ']},
    {id:'folha', name:'Folha docente', color:'#418d9d'},
    {id:'plano', name:'Plano docente', color:'#9270d4'},
    {id:'lato-sensu', name:'Operação lato sensu BreCIA', color:'#2ca79a'},
    {id:'pagamentos-pj', name:'Pendências de pagamento PJ', color:'#dbab56'},
    {id:'ubracis', name:'Ubracis', color:'#418d9d'},
    {id:'suporte', name:'Suporte operacional', color:'#507ee9'},
    {id:'cpa', name:'CPA Ubrecia', color:'#2ca79a', aliases:['CPA / Avaliação']},
    {id:'capacitacao', name:'Capacitação', color:'#9270d4'}
  ].map(area => Object.freeze({...area, aliases:Object.freeze(area.aliases||[])}));
  const nameKey = name => String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
  const defaults = () => catalog.map(({id,name,color})=>({id,name,color}));

  function migrate(db) {
    if (db.classificationCatalogVersion === version) return db;
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
