import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Disconnecting Agenda keeps the shared Google token available to Gmail',async()=>{
 const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',url='https://test.supabase.co',user={id,email:'user@example.test'};
 const values=new Map([['flow.auth.session.v1',JSON.stringify({project:url,user,access_token:'access',expires_at:2100000000,provider_token:'google-provider',calendarConnected:true,gmailConnected:true})]]);
 const context={URLSearchParams,AbortSignal,location:{search:'',pathname:'/',hash:''},window:{dispatchEvent(){},addEventListener(){}},CustomEvent:class{},setTimeout,clearTimeout,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},fetch:async path=>Response.json(path==='/api/auth-config'?{configured:true,url,key:'public-key'}:path.endsWith('/auth/v1/user')?user:[])};
 vm.createContext(context);vm.runInContext(readFileSync('cloud.js','utf8'),context);await context.FlowCloud.initialize();context.FlowCloud.disconnectCalendar();assert.equal(context.FlowCloud.calendarToken(),null);assert.equal(context.FlowCloud.gmailToken(),'google-provider');
 context.FlowCloud.disconnectGmail();assert.equal(context.FlowCloud.gmailToken(),null);
});
