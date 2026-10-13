import test from 'node:test';
import assert from 'node:assert/strict';
import {POST,validateReview,geminiFailure,selectReviewModel} from '../api/gmail-review.mjs';
const areas=[{id:'oferta',name:'Oferta de turmas'}];
// Sessão Supabase de uma conta Google e cota diária disponível (api/auth-config.mjs e supabase/flow.sql).
const account=url=>url.endsWith('/auth/v1/user')?Response.json({id:'verified-user',app_metadata:{provider:'google'},identities:[{provider:'google',identity_data:{email:'user@example.test',email_verified:true}}]}):url.endsWith('/rest/v1/rpc/flow_ai_quota_hit')?Response.json({allowed:true,used:1,limit:300}):null;
test('Review keeps only known areas and bounds untrusted output',()=>{const r=validateReview({summary:'Resumo',title:'Título',areaId:'inventada',dueDate:'amanhã',alert:'a'.repeat(400)},areas);assert.equal(r.areaId,'');assert.equal(r.dueDate,'');assert.equal(r.alert.length,300);assert.equal(r.needsReview,true);});
test('Authenticated Gemini review checks identity and rejects invented date evidence',async()=>{
 const originalFetch=globalThis.fetch,oldEnv={...process.env};let calls=[];
 process.env.GEMINI_API_KEY='test-secret';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return account(url)||Response.json({candidates:[{content:{parts:[{text:JSON.stringify({summary:'Pedido de revisão',title:'Revisar turmas',areaId:'oferta',dueDate:'2026-10-20',dateEvidence:'Prazo inventado',needsReview:false,alert:''})}]}}]});};
 try{
  const request=()=>new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({subject:'Turmas',text:'Solicito revisão',areas})});
  const result=await POST(request());assert.equal(result.status,200);const r=await result.json();assert.equal(r.dueDate,'');assert.equal(r.areaId,'oferta');assert.equal(calls[0].url,'https://test.supabase.co/auth/v1/user');assert.equal(calls[1].url,'https://test.supabase.co/rest/v1/rpc/flow_ai_quota_hit');assert.equal(calls[1].options.headers.authorization,'Bearer '+'a'.repeat(25));assert.equal(calls[2].options.headers['x-goog-api-key'],'test-secret');assert.ok(JSON.parse(calls[2].options.body).systemInstruction);
  calls=[];const denied=await POST(new Request('https://flow.test/api/gmail-review',{method:'POST'}));assert.equal(denied.status,401);assert.equal(calls.length,0);
  globalThis.fetch=async()=>new Response('{}',{status:401});assert.equal((await POST(request())).status,401);
 }finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});

test('Google failures identify quota, disabled service, invalid keys and model errors without exposing credentials',()=>{
 assert.match(geminiFailure(429),/cota/);
 assert.match(geminiFailure(400,{error:{details:[{reason:'API_KEY_INVALID'}]}}),/chave Gemini foi rejeitada/);
 assert.match(geminiFailure(403,{error:{details:[{reason:'SERVICE_DISABLED'}]}}),/Generative Language/);
 assert.match(geminiFailure(403,{error:{details:[{reason:'API_KEY_HTTP_REFERRER_BLOCKED'}]}}),/restrição/);
 assert.match(geminiFailure(404),/modelo/);
 const message=geminiFailure(403,{error:{message:'PRIVATE-KEY-HERE'}});assert.ok(!message.includes('PRIVATE-KEY-HERE'));
});

test('Model discovery selects a supported stable Flash and excludes image, audio and unsupported models',()=>{assert.equal(selectReviewModel([{name:'models/gemini-3.1-flash-preview',supportedGenerationMethods:['generateContent']},{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-4-flash-image',supportedGenerationMethods:['generateContent']}]),'gemini-2.5-flash');assert.equal(selectReviewModel([{name:'models/gemini-3-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-2-flash',supportedGenerationMethods:['generateContent']}]),'gemini-3-flash');assert.equal(selectReviewModel([{name:'models/gemini-3-flash',supportedGenerationMethods:['embedContent']}]),'');});
test('A missing configured model is resolved from the actual models available to the key',async()=>{
 const oldEnv={...process.env},originalFetch=globalThis.fetch;const calls=[];
 process.env.GEMINI_API_KEY='discovery-test-key';process.env.GEMINI_REVIEW_MODEL=' models/unavailable-model ';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{calls.push(url);if(account(url))return account(url);if(url.includes('unavailable-model:generateContent'))return Response.json({error:{}},{status:404});if(url.includes('/models?'))return Response.json({models:[{name:'models/gemini-3-flash',supportedGenerationMethods:['generateContent']}]});return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({summary:'Resumo',title:'Revisar turmas',areaId:'oferta',dueDate:'',dateEvidence:'',needsReview:false,alert:''})}]}}]});};
 try{const request=()=>new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({subject:'Turmas',text:'Revisar turmas',areas})});const result=await POST(request());assert.equal(result.status,200);assert.equal((await result.json()).modelUsed,'gemini-3-flash');assert.ok(calls.some(url=>url.includes('/models?')));calls.length=0;assert.equal((await POST(request())).status,200);assert.ok(!calls.some(url=>url.includes('/models?')||url.includes('unavailable-model')));}finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});

test('HTTP 400 reports the rejected parameter while redacting the server key',()=>{const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-secret-key';try{const message=geminiFailure(400,{error:{message:'Invalid responseSchema using test-secret-key'}});assert.match(message,/responseSchema/);assert.ok(!message.includes('test-secret-key'));}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}});
test('Models that reject structured output retry with a minimal request and still validate JSON',async()=>{
 const oldEnv={...process.env},originalFetch=globalThis.fetch;let generates=0;
 process.env.GEMINI_API_KEY='schema-compatibility-test';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{if(account(url))return account(url);generates++;const body=JSON.parse(options.body);if(body.generationConfig.responseSchema)return Response.json({error:{message:'responseSchema is not supported by this model'}},{status:400});assert.ok(!body.systemInstruction);assert.match(body.contents[0].parts[0].text,/summary, title, areaId/);return Response.json({candidates:[{content:{parts:[{text:'```json\n'+JSON.stringify({summary:'Resumo',title:'Revisar',areaId:'oferta',dueDate:'',dateEvidence:'',alert:'',needsReview:true})+'\n```'}]}}]});};
 try{const result=await POST(new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({subject:'Turmas',text:'Revisar',areas})}));assert.equal(result.status,200);assert.equal((await result.json()).title,'Revisar');assert.equal(generates,2);}finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});

test('Interactions-only models use the required endpoint, disable storage and cache the API choice',async()=>{
 const oldEnv={...process.env},originalFetch=globalThis.fetch;let legacy=0,interactions=0;
 process.env.GEMINI_API_KEY='interactions-test-key';process.env.GEMINI_REVIEW_MODEL='gemini-interactions-flash';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{if(account(url))return account(url);if(url.endsWith(':generateContent')){legacy++;return Response.json({error:{message:'This model only supports Interactions API.'}},{status:400});}assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');interactions++;const request=JSON.parse(options.body);assert.equal(request.store,false);assert.equal(request.model,'gemini-interactions-flash');assert.match(request.input,/summary, title, areaId/);return Response.json({outputs:[{type:'text',text:JSON.stringify({summary:'Revisar turmas',title:'Revisar',areaId:'oferta',dueDate:'',dateEvidence:'',needsReview:false,alert:''})}]});};
 try{const request=()=>new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({subject:'Turmas',text:'Revisar',areas})});assert.equal((await POST(request())).status,200);assert.equal((await POST(request())).status,200);assert.equal(legacy,1);assert.equal(interactions,2);}finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});

test('Reply assistance uses a drafting instruction and returns editable text rather than classification',async()=>{
 const oldEnv={...process.env},originalFetch=globalThis.fetch;
 process.env.GEMINI_API_KEY='reply-draft-test';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{if(account(url))return account(url);const request=JSON.parse(options.body);assert.match(request.systemInstruction.parts[0].text,/Não envie nada/);assert.deepEqual(request.generationConfig.responseSchema.required,['text']);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({text:'Prezada, vou verificar a solicitação.'})}]}}]});};
 try{const result=await POST(new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({mode:'reply',subject:'Turmas',text:'Ideia: vou verificar',areas:[]})}));assert.equal(result.status,200);assert.equal((await result.json()).reply,'Prezada, vou verificar a solicitação.');}finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});
