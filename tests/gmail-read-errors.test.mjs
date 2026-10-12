import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('gmail-review.js','utf8');
function setup(status,body){let disconnected=0;const context={AbortSignal,TextDecoder,Uint8Array,URLSearchParams,CustomEvent:class{},window:{dispatchEvent(){}},FlowCloud:{gmailToken:()=>disconnected?null:'token',info:()=>({user:{id:'owner',email:'user@ulbra.br'}}),disconnectGmail:()=>{disconnected++},analyzeGmail:()=>{throw new Error('Must not analyze when inbox read failed')}},fetch:async()=>Response.json(body,{status})};vm.createContext(context);vm.runInContext(source,context);return {review:context.FlowGmailReview,disconnected:()=>disconnected};}
test('Disabled Gmail API remains visible after automatic analysis and keeps authorization',async()=>{const h=setup(403,{error:{details:[{reason:'SERVICE_DISABLED'}]}});await h.review.refresh();await h.review.analyze({tasks:[]},()=>{});assert.match(h.review.info().error,/Gmail API está desativada/);assert.equal(h.disconnected(),0);assert.equal(h.review.info().loading,false);});
test('Insufficient scopes request reauthorization and retain the reason',async()=>{const h=setup(403,{error:{errors:[{reason:'insufficientPermissions'}]}});await h.review.refresh();await h.review.analyze({},()=>{});assert.equal(h.disconnected(),1);assert.match(h.review.info().error,/não liberou a leitura/);});
test('Expired token and rate limit have different actionable messages',async()=>{const expired=setup(401,{});await expired.review.refresh();assert.match(expired.review.info().error,/expirou/);const limited=setup(429,{});await limited.review.refresh();assert.match(limited.review.info().error,/limite de consultas/);assert.equal(limited.disconnected(),0);});
