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
test('Connection verifies credentials before keeping a per-user token',()=>{const h=harness();h.context.flowConnect(h.form({flowToken:'a'.repeat(64)}));assert.equal(h.properties.get('flowToken'),'a'.repeat(64));const payload=JSON.parse(h.calls.at(-1).options.payload);assert.equal(payload.token_hash,createHash('sha256').update('a'.repeat(64)).digest('hex'));assert.equal(payload.action,'areas');});
test('Save submits metadata and matching Google account; invalid form sends nothing',()=>{const h=harness();h.properties.set('flowToken','a'.repeat(64));h.context.flowSave(h.form({title:'Turmas',projectId:'oferta',dueDate:'invalid'}));assert.equal(h.calls.length,0);h.context.flowSave(h.form({title:'Turmas',projectId:'oferta',dueDate:'2026-10-20'}));const body=JSON.parse(h.calls.at(-1).options.payload);assert.equal(body.action,'save');assert.equal(body.payload.gmailUrl,'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/abcdef1234567890');assert.equal(body.payload.captureId,'gmail-mobile-abcdef1234567890');});
test('No token cannot capture and disconnect removes only the current user token',()=>{const h=harness();assert.throws(()=>h.context.flowRpc('save',{}),/Conecte/);h.properties.set('flowToken','a'.repeat(64));h.context.flowDisconnect();assert.equal(h.properties.has('flowToken'),false);});
