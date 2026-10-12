import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../api/gemini.mjs';
test('Task assistant accepts both Interactions text response formats and keeps authentication',async()=>{
 const oldEnv={...process.env},oldFetch=globalThis.fetch;
 process.env.GEMINI_API_KEY='test-key';process.env.FLOW_AI_ACCESS_TOKEN='test-password';
 const request=()=>new Request('https://test/api/gemini',{method:'POST',headers:{'content-type':'application/json','x-flow-access-token':'test-password'},body:JSON.stringify({mode:'reply',title:'Turmas',description:'Conferir turmas'})});
 try{
  for(const result of [{outputs:[{type:'text',text:'Resposta atual.'}]},{steps:[{type:'model_output',content:[{type:'text',text:'Resposta anterior.'}]}]}]){
   globalThis.fetch=async(url,options)=>{assert.equal(JSON.parse(options.body).store,false);assert.ok(options.signal);return Response.json(result);};
   const response=await POST(request());assert.equal(response.status,200);assert.match((await response.json()).text,/Resposta/);
  }
  assert.equal((await POST(new Request('https://test/api/gemini',{method:'POST'}))).status,401);
 }finally{process.env=oldEnv;globalThis.fetch=oldFetch;}
});
