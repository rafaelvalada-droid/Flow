import test from 'node:test';
import assert from 'node:assert/strict';
import {POST,validateReview} from '../api/gmail-review.mjs';
const areas=[{id:'oferta',name:'Oferta de turmas'}];
test('Review keeps only known areas and bounds untrusted output',()=>{const r=validateReview({summary:'Resumo',title:'Título',areaId:'inventada',dueDate:'amanhã',alert:'a'.repeat(400)},areas);assert.equal(r.areaId,'');assert.equal(r.dueDate,'');assert.equal(r.alert.length,300);assert.equal(r.needsReview,true);});
test('Authenticated Gemini review checks identity and rejects invented date evidence',async()=>{
 const originalFetch=globalThis.fetch,oldEnv={...process.env};let calls=[];
 process.env.GEMINI_API_KEY='test-secret';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/auth/v1/user')?{id:'verified-user'}:{candidates:[{content:{parts:[{text:JSON.stringify({summary:'Pedido de revisão',title:'Revisar turmas',areaId:'oferta',dueDate:'2026-10-20',dateEvidence:'Prazo inventado',needsReview:false,alert:''})}]}}]});};
 try{
  const request=()=>new Request('https://flow.test/api/gmail-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(25)},body:JSON.stringify({subject:'Turmas',text:'Solicito revisão',areas})});
  const result=await POST(request());assert.equal(result.status,200);const r=await result.json();assert.equal(r.dueDate,'');assert.equal(r.areaId,'oferta');assert.equal(calls[0].url,'https://test.supabase.co/auth/v1/user');assert.equal(calls[1].options.headers['x-goog-api-key'],'test-secret');assert.ok(JSON.parse(calls[1].options.body).systemInstruction);
  calls=[];const denied=await POST(new Request('https://flow.test/api/gmail-review',{method:'POST'}));assert.equal(denied.status,401);assert.equal(calls.length,0);
  globalThis.fetch=async()=>new Response('{}',{status:401});assert.equal((await POST(request())).status,401);
 }finally{globalThis.fetch=originalFetch;process.env=oldEnv;}
});
