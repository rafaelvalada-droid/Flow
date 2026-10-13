import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectPlan,validateProjectAssessment} from '../api/project-plan.mjs';
import {POST} from '../api/gmail-review.mjs';
const fields=[{id:'0',name:'Planejar'},{id:'1',name:'Executar'}];
const plan=()=>({name:'Melhoria',description:'Melhorar o processo',sections:[{id:'0',text:'Planejar'},{id:'1',text:'Executar'}],milestones:[{name:'Entrega',dueDate:'2026-11-15'}],risks:[{title:'Falta de dados',mitigation:'Levantar dados'}]});
test('plans require all known stages, reject invented or repeated stages, and bound output',()=>{
 const value=plan();value.name='N'.repeat(200);assert.equal(validateProjectPlan(value,fields,'').name.length,100);
 for(const sections of [[{id:'0',text:'A'}],[{id:'0',text:'A'},{id:'0',text:'B'}],[{id:'0',text:'A'},{id:'invented',text:'B'}]])assert.throws(()=>validateProjectPlan({...plan(),sections},fields,''));
});
test('a proposed milestone cannot invent a deadline absent from the source',()=>{
 assert.equal(validateProjectPlan(plan(),fields,'sem data').milestones[0].dueDate,'');
 assert.equal(validateProjectPlan(plan(),fields,'Prazo 2026-11-15').milestones[0].dueDate,'2026-11-15');
 const invalid=plan();invalid.milestones[0].dueDate='2026-02-30';assert.equal(validateProjectPlan(invalid,fields,'2026-02-30').milestones[0].dueDate,'');
});
test('assessment only recommends existing methods, without repeats',()=>{
 const models=[{id:'pdca',name:'PDCA'}];
 assert.equal(validateProjectAssessment({summary:'Problema de melhoria',recommendations:[{modelId:'pdca',reason:'Ciclo de melhoria',firstSteps:'Medir o processo'}]},models).recommendations[0].modelId,'pdca');
 for(const recommendations of [[],[{modelId:'unknown',reason:'',firstSteps:''}],[{modelId:'pdca',reason:'',firstSteps:''},{modelId:'pdca',reason:'',firstSteps:''}]])assert.throws(()=>validateProjectAssessment({summary:'Teste',recommendations},models));
});
test('authenticated Gemini project endpoints use the proper schemas and validate output',async()=>{
 const previous={...process.env},originalFetch=globalThis.fetch;let response=plan(),instruction;
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';process.env.GEMINI_API_KEY='project-generator-test';process.env.GEMINI_REVIEW_MODEL='gemini-2.5-flash';
 globalThis.fetch=async(url,options)=>{if(url.endsWith('/auth/v1/user'))return Response.json({id:'verified-user'});const body=JSON.parse(options.body);instruction=body.systemInstruction.parts[0].text;assert.equal(body.generationConfig.responseMimeType,'application/json');return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(response)}]}}]});};
 const request=(mode,areas)=>new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({mode,subject:'Projeto',text:'Melhorar o processo',areas})});
 try{
  const generated=await POST(request('project-plan',fields));assert.equal(generated.status,200);assert.equal((await generated.json()).projectPlan.sections.length,2);assert.match(instruction,/Não invente responsáveis/);
  response={summary:'Melhoria recorrente',recommendations:[{modelId:'pdca',reason:'Melhoria cíclica',firstSteps:'Medir'}]};const assessed=await POST(request('project-assess',[{id:'pdca',name:'PDCA'}]));assert.equal(assessed.status,200);assert.equal((await assessed.json()).projectAssessment.recommendations[0].modelId,'pdca');
  response={summary:'Teste',recommendations:[{modelId:'invented',reason:'',firstSteps:''}]};assert.equal((await POST(request('project-assess',[{id:'pdca',name:'PDCA'}]))).status,502);
  response={text:'Projeto melhorado'};const named=await POST(request('project-title',[]));assert.equal((await named.json()).reply,'Projeto melhorado');assert.match(instruction,/até 100 caracteres/);
  assert.equal((await POST(new Request('https://flow.test/api/gmail-review',{method:'POST'}))).status,401);
 }finally{globalThis.fetch=originalFetch;process.env=previous;}
});
