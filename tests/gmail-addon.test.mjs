import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
function harness(){
 const properties=new Map(),calls=[];
 const builder=()=>new Proxy({},{get:(_,name)=>name==='build'?()=>({built:true}):()=>builder()});
 const context={CardService:new Proxy({SelectionInputType:{DROPDOWN:'dropdown'}},{get:(o,k)=>o[k]||builder}),PropertiesService:{getUserProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,v)=>[...createHash('sha256').update(v).digest()]},Session:{getActiveUser:()=>({getEmail:()=> 'user@ulbra.br'})},GmailApp:{setCurrentMessageAccessToken:()=>{},getMessageById:()=>({getSubject:()=> 'Turmas',getFrom:()=> 'sender@ulbra.br'})},UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.endsWith('auth-config')?{configured:true,url:'https://iwnbrcsmzwjziyluwrrb.supabase.co',key:'sb_publishable_test'}:{projects:[{id:'oferta',name:'Oferta'}],taskId:'test-task'})}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('gmail-addon/Code.gs','utf8'),context);
 const form=values=>({commonEventObject:{formInputs:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{stringInputs:{value:[v]}}])),parameters:{threadId:'abcdef1234567890',subject:'Turmas',sender:'sender@ulbra.br',account:'user@ulbra.br'}}});
 return {context,calls,properties,form};
}
test('Connection verifies credentials with the raw key on the v2 RPC before keeping a per-user token',()=>{const h=harness();h.context.flowConnect(h.form({flowToken:'a'.repeat(64)}));assert.equal(h.properties.get('flowToken'),'a'.repeat(64));const call=h.calls.at(-1),payload=JSON.parse(call.options.payload);assert.match(call.url,/\/rest\/v1\/rpc\/flow_gmail_capture_v2$/);assert.equal(payload.token,'a'.repeat(64));assert.equal(payload.token_hash,undefined);assert.ok(!call.options.payload.includes(createHash('sha256').update('a'.repeat(64)).digest('hex')),'The stored hash is never sent');assert.equal(payload.action,'areas');});
test('Save submits metadata and matching Google account; invalid form sends nothing',()=>{const h=harness();h.properties.set('flowToken','a'.repeat(64));h.context.flowSave(h.form({title:'Turmas',projectId:'oferta',dueDate:'invalid'}));assert.equal(h.calls.length,0);h.context.flowSave(h.form({title:'Turmas',projectId:'oferta',dueDate:'2026-10-20'}));const body=JSON.parse(h.calls.at(-1).options.payload);assert.equal(body.action,'save');assert.equal(body.payload.gmailUrl,'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/abcdef1234567890');assert.equal(body.payload.captureId,'gmail-mobile-abcdef1234567890');assert.equal(body.payload.gmailThreadId,'abcdef1234567890');});
test('No token cannot capture and disconnect removes only the current user token',()=>{const h=harness();assert.throws(()=>h.context.flowRpc('save',{}),/Conecte/);h.properties.set('flowToken','a'.repeat(64));h.context.flowDisconnect();assert.equal(h.properties.has('flowToken'),false);});
test('Add-on thread IDs are normalized to the lowercase hex used by the Gmail API, SQL and UlbraFlow',()=>{
 const h=harness(),decimal='1781234567890123456',hex=BigInt(decimal).toString(16);
 assert.equal(h.context.flowGmailId('thread-f:'+decimal,'thread-f'),hex);
 assert.equal(h.context.flowGmailId('#thread-f:'+decimal,'thread-f'),hex);
 assert.equal(h.context.flowGmailId('18B2C3D4E5F6A7B8','thread-f'),'18b2c3d4e5f6a7b8');
 assert.equal(h.context.flowGmailId('msg-f:'+decimal,'msg-f'),hex);
 for(const invalid of ['thread-a:r-123','thread-f:12a','abc','',null,'thread-f:'+decimal+' OR 1=1'])assert.equal(h.context.flowGmailId(invalid,'thread-f'),'');
});
test('Opening a message with thread-f/msg-f IDs saves the hex thread, message and link',()=>{
 const h=harness(),decimal='1781234567890123456',hex=BigInt(decimal).toString(16);let parameters;
 h.context.CardService.newAction=()=>({setFunctionName(){return this;},setParameters(value){parameters=value;return this;}});
 h.properties.set('flowToken','a'.repeat(64));
 h.context.flowMessage({gmail:{accessToken:'t',messageId:'msg-f:1781234567890123457',threadId:'thread-f:'+decimal}});
 assert.equal(parameters.threadId,hex);assert.equal(parameters.messageId,BigInt('1781234567890123457').toString(16));
 const event=h.form({title:'Turmas',projectId:'oferta',dueDate:'2026-10-20'});event.commonEventObject.parameters=parameters;
 h.context.flowSave(event);const body=JSON.parse(h.calls.at(-1).options.payload).payload;
 assert.equal(body.gmailUrl,'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+hex);assert.equal(body.captureId,'gmail-mobile-'+hex);assert.equal(body.gmailThreadId,hex);assert.equal(body.gmailMessageId,parameters.messageId);
 assert.match(body.gmailUrl,/#all\/[a-f0-9]{8,40}$/);
 // Cartões criados pela versão anterior ainda trazem thread-f nos parâmetros.
 event.commonEventObject.parameters={...parameters,threadId:'thread-f:'+decimal,messageId:''};h.context.flowSave(event);
 assert.equal(JSON.parse(h.calls.at(-1).options.payload).payload.gmailThreadId,hex);
 const calls=h.calls.length;event.commonEventObject.parameters={...parameters,threadId:'thread-a:r-1'};h.context.flowSave(event);assert.equal(h.calls.length,calls,'An unknown thread format sends nothing');
});
