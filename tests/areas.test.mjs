import test from 'node:test';
import assert from 'node:assert/strict';
import '../areas.js';
import '../workflow.js';

const areas=globalThis.FlowAreas;

test('existing work receives the requested classification choices without losing task links or history',()=>{
  const db={projects:[
    {id:'carga',name:'Carga Horária Docente',color:'#9270d4'},
    {id:'oferta',name:'Oferta de Turmas',color:'#507ee9'},
    {id:'cpa',name:'CPA / Avaliação',color:'#2ca79a'},
    {id:'ouv',name:'Ouvidoria',color:'#dbab56'},
    {id:'folha',name:'Folha Docente',color:'#418d9d'},
    {id:'pj',name:'Contratos PJ',color:'#ca8265'}
  ],tasks:[
    {id:'task-pj',project:'pj',status:'todo',dueDate:'2026-10-15',description:'Existing notes',sessions:[{start:10000,end:30000}]},
    {id:'task-ouv',project:'ouv',status:'waiting',dueDate:'2026-10-16',sessions:[]}
  ]};
  const before=structuredClone(db);
  areas.migrate(db);
  assert.equal(db.projects.length,13);
  assert.deepEqual(db.tasks,before.tasks);
  assert.equal(db.projects.find(p=>p.id==='pj').name,'Contratos docentes PJ');
  assert.equal(db.projects.find(p=>p.id==='cpa').name,'CPA Ubrecia');
  assert(db.projects.some(p=>p.name==='Ubra IA'));
  assert(db.projects.some(p=>p.name==='Operação Lato Sensu Ulbra S.A.'));
  assert.equal(db.projects.some(p=>p.id==='ouv'),false);
  assert.deepEqual(db.archivedProjects,[before.projects.find(p=>p.id==='ouv')]);
  assert.equal(globalThis.FlowWorkflow.classified(db,db.tasks[1]),true);
  const first=structuredClone(db);areas.migrate(db);assert.deepEqual(db,first);
});

test('custom category IDs are reused and unrelated user categories survive the catalog update',()=>{
  const db={projects:[
    {id:'my-contracts',name:'Contrato docente PJ',color:'#123456'},
    {id:'my-area',name:'Minha área personalizada',color:'#abcdef'}
  ],tasks:[{id:'t',project:'my-contracts'}]};
  areas.migrate(db);
  assert.equal(db.projects.find(p=>p.id==='my-contracts').name,'Contratos docentes PJ');
  assert.equal(db.projects.find(p=>p.id==='my-contracts').color,'#123456');
  assert.equal(db.projects.filter(p=>p.name==='Contratos docentes PJ').length,1);
  assert.equal(db.tasks[0].project,'my-contracts');
  assert(db.projects.some(p=>p.id==='my-area'&&p.name==='Minha área personalizada'));
  // Uma atualização posterior não restaura áreas retiradas deliberadamente.
  db.projects=db.projects.filter(p=>p.id!=='capacitacao');areas.migrate(db);
  assert.equal(db.projects.some(p=>p.id==='capacitacao'),false);
});

test('a conflicting custom ID is preserved instead of being assigned to a different category',()=>{
  const db={projects:[{id:'ubra-ia',name:'Meu setor',color:'#123456'}],tasks:[{project:'ubra-ia'}]};
  areas.migrate(db);
  assert.equal(db.projects.find(p=>p.id==='ubra-ia').name,'Meu setor');
  assert.notEqual(db.projects.find(p=>p.name==='Ubra IA').id,'ubra-ia');
  assert.equal(db.tasks[0].project,'ubra-ia');
});

 test('correcting the Lato Sensu name preserves existing IDs, tasks and removed categories',()=>{
 const db={classificationCatalogVersion:2,projects:[{id:'custom-lato',name:'Operação lato sensu BreCIA',color:'#123456'},{id:'lato-sensu',name:'Nome personalizado'}],archivedProjects:[{id:'old-lato',name:'Operação lato sensu BreCIA'}],tasks:[{project:'custom-lato',sessions:[{start:1,end:2}]}]};
 const tasks=structuredClone(db.tasks);areas.migrate(db);
 assert.equal(db.projects[0].name,'Operação Lato Sensu Ulbra S.A.');assert.equal(db.projects[0].id,'custom-lato');assert.equal(db.projects[1].name,'Nome personalizado');assert.equal(db.archivedProjects[0].name,'Operação Lato Sensu Ulbra S.A.');assert.deepEqual(db.tasks,tasks);assert.equal(db.projects.length,2);
});
