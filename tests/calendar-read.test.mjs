import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../calendar.js',import.meta.url),'utf8');
function setup(fetch){
 let token='provider';
 const context={FlowCloud:{calendarToken:()=>token,info:()=>({user:{id:'owner'}}),disconnectCalendar:()=>{token=null}},
 fetch,URLSearchParams,AbortSignal,queueMicrotask,setTimeout,clearTimeout,setInterval:()=>{},document:{addEventListener:()=>{}},window:{dispatchEvent:()=>{}},CustomEvent:class{},crypto:globalThis.crypto};
 vm.createContext(context);vm.runInContext(source,context);
 const calendar=context.FlowCalendar;
 calendar.initialize(()=>({tasks:[{id:'task',plannedDate:'2026-10-13'}]}),()=>{});
 return calendar;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const event=(id,extra={})=>({id,start:{date:'2026-10-13'},end:{date:'2026-10-14'},...extra});
test('paginated recurring instances load without writes, cancelled events or task duplicates',async()=>{
 const calls=[];
 const calendar=setup(async(url,options)=>{
  assert.equal(options.method,'GET');calls.push(url);
  return {ok:true,status:200,json:async()=>url.includes('pageToken=next')?{items:[event('second')]}:{items:[event('first'),event('cancel',{status:'cancelled'}),event('owned',{extendedProperties:{private:{flowUserId:'owner',flowTaskId:'task'}}})],nextPageToken:'next'}};
 });
 calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await tick();
 assert.equal(calls.length,2);assert.match(calls[0],/singleEvents=true/);
 assert.deepEqual(Array.from(calendar.info().events,e=>e.id),['first','second']);
 calendar.disconnect();assert.equal(calendar.info().events.length,0);
});
test('a late previous-week response cannot replace the current week',async()=>{
 let release;
 const calendar=setup(async url=>({ok:true,status:200,json:async()=>url.includes('2026-10-12')?await new Promise(r=>{release=r}):{items:[event('current')]}}));
 calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await tick();
 calendar.showRange('2026-10-19T03:00:00Z','2026-10-26T03:00:00Z');await tick();
 release({items:[event('stale')]});await tick();assert.equal(calendar.info().events[0].id,'current');calendar.disconnect();
});
test('expired authorization clears appointments and requires reconnecting',async()=>{
 const calendar=setup(async()=>Response.json({error:{message:'Unauthorized'}},{status:401}));calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await tick();
 assert.equal(calendar.info().connected,false);assert.equal(calendar.info().events.length,0);assert.match(calendar.info().readError,/novamente/);calendar.disconnect();
});

test('Unrelated saves do not synchronize Agenda; edits during a request receive another sync',async()=>{
 const timers=new Map();let timerId=0,release,hold=true;const writes=[];
 const db={projects:[{id:'area',name:'Área'}],preferences:{focusMinutes:25},tasks:[{id:'task',title:'Antes',project:'area',plannedDate:'2026-10-13',description:''}]};
 const context={TextEncoder,FlowCloud:{calendarToken:()=> 'provider',info:()=>({user:{id:'owner'}}),disconnectCalendar(){}},crypto:globalThis.crypto,AbortSignal,URLSearchParams,queueMicrotask,setInterval(){},setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),window:{dispatchEvent(){}},document:{addEventListener(){}},CustomEvent:class{},FlowWorkflow:{validDate:()=>true},fetch:async(url,options)=>{
  if(options.method==='POST'){const body=JSON.parse(options.body);writes.push(body.summary);if(hold){hold=false;await new Promise(resolve=>{release=resolve});}return Response.json(body);}
  throw new Error('Unexpected calendar request');
 }};
 vm.createContext(context);vm.runInContext(source,context);const calendar=context.FlowCalendar;calendar.initialize(()=>db,()=>calendar.schedule());
 const pending=calendar.synchronize();while(!release)await tick();db.tasks[0].title='Depois';calendar.schedule();
 const callback=[...timers.values()][0];timers.clear();callback();release();await pending;
 assert.ok(timers.size,'Changed input must remain scheduled after a slow request finishes');
 const retry=[...timers.values()][0];timers.clear();retry();while(calendar.info().status==='syncing')await tick();assert.deepEqual(writes,['Antes','Depois']);
 timers.clear();db.gmailReviews={email:{summary:'Nothing changed in Agenda'}};calendar.schedule();assert.equal(timers.size,0);calendar.disconnect();
});

test('disabled Calendar API keeps the connection for retry after configuration',async()=>{
 const calendar=setup(async()=>Response.json({error:{errors:[{reason:'accessNotConfigured'}]}},{status:403}));
 calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await tick();
 assert.equal(calendar.info().connected,true);assert.match(calendar.info().readError,/conexão foi mantida/);calendar.disconnect();
});
