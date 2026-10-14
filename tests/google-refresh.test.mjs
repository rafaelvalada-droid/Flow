import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {POST} from '../api/google-token.mjs';
import {GET} from '../api/auth-config.mjs';

const A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',URL_BASE='https://test.supabase.co';
const user={id:A,email:'a@example.test',identities:[{provider:'google',identity_data:{sub:'google-a'}}]};
const sessionKey='flow.auth.session.v1';
const gmail='https://gmail.googleapis.com/gmail/v1/users/me/profile';
const agenda='https://www.googleapis.com/calendar/v3/calendars/primary/events';

async function backend(run,overrides={}){
  const envKeys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
  Object.assign(process.env,{SUPABASE_URL:URL_BASE,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-server-client-secret'});
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return Response.json(user,{status:overrides.authStatus||200});
    if(url==='https://oauth2.googleapis.com/token')return Response.json(overrides.token||{access_token:'renewed-google-access',expires_in:3600},{status:overrides.tokenStatus||200});
    if(url.endsWith('/oauth2/v3/userinfo'))return Response.json(overrides.profile||{sub:'google-a',email:'a@example.test',email_verified:true});
    throw new Error('Unexpected request');
  };
  try{await run(calls);}finally{globalThis.fetch=originalFetch;for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
}
const request=()=>new Request('https://app.example.test/api/google-token',{method:'POST',headers:{authorization:'Bearer test-auth-session-long-enough','content-type':'application/json'},body:JSON.stringify({refreshToken:'test-google-refresh-token'})});

test('server authenticates the user, binds Google identity, and keeps client secret private',()=>backend(async calls=>{
  const response=await POST(request()),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(body.accessToken,'renewed-google-access');assert.equal(body.expiresIn,3600);
  assert.ok(!JSON.stringify(body).includes(process.env.GOOGLE_CLIENT_SECRET));
  assert.equal(calls.length,3);const form=calls[1].options.body;
  assert.equal(form.get('client_secret'),process.env.GOOGLE_CLIENT_SECRET);assert.equal(form.get('grant_type'),'refresh_token');
}));
test('unauthenticated requests cannot use the refresh endpoint',()=>backend(async calls=>{
  const response=await POST(new Request('https://app.example.test/api/google-token',{method:'POST'}));
  assert.equal(response.status,401);assert.equal(calls.length,0);
}));
test('a rejected Supabase session never reaches Google',()=>backend(async calls=>{
  assert.equal((await POST(request())).status,401);assert.equal(calls.length,1);
},{authStatus:401}));
test('a Google credential belonging to another account is never returned',()=>backend(async()=>{
  const response=await POST(request()),body=await response.json();
  assert.equal(response.status,409);assert.equal(body.code,'GOOGLE_RECONNECT_REQUIRED');assert.ok(!body.accessToken);
},{profile:{sub:'google-b',email:'b@example.test',email_verified:true}}));
test('revoked grants require reconnect while client misconfiguration remains recoverable',async()=>{
  for(const [error,status,code] of [['invalid_grant',409,'GOOGLE_RECONNECT_REQUIRED'],['invalid_client',503,'GOOGLE_REFRESH_NOT_CONFIGURED']]){
    await backend(async()=>{const response=await POST(request()),body=await response.json();assert.equal(response.status,status);assert.equal(body.code,code);assert.ok(!JSON.stringify(body).includes('private-detail'));},{tokenStatus:400,token:{error,error_description:'private-detail'}});
  }
});
test('missing OAuth configuration is explicit and public config exposes only readiness',()=>backend(async calls=>{
  delete process.env.GOOGLE_CLIENT_SECRET;
  const response=await POST(request()),body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'GOOGLE_REFRESH_NOT_CONFIGURED');assert.equal(calls.length,1);
  const configuration=await GET().json();assert.equal(configuration.googleRefreshConfigured,false);assert.ok(!JSON.stringify(configuration).includes('test.apps.googleusercontent.com'));
}));

async function client({values,expired=true,refreshResponse,googleUnauthorized=false,holdRefresh=false,supabaseExpired=false}={}){
  values=values||new Map([[sessionKey,JSON.stringify({project:URL_BASE,user,access_token:'test-supabase-access-token',refresh_token:'test-supabase-refresh-token',expires_at:supabaseExpired?1:2100000000,provider_token:'old-google-access',provider_refresh_token:'test-google-refresh-token',google_access_expires_at:expired?1:2100000000,gmailConnected:true,calendarConnected:true})]]);
  const calls=[],assigned=[];let release,renewals=0;
  const context={URL,URLSearchParams,AbortSignal,navigator:{locks:{request:(_,fn)=>fn()}},location:{search:'',pathname:'/',hash:'',assign:url=>assigned.push(url),reload(){}},window:{dispatchEvent(){},addEventListener(){}},CustomEvent:class{},setTimeout,clearTimeout,
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},fetch:async(url,options={})=>{
      calls.push({url,options});
      if(url==='/api/auth-config')return Response.json({configured:true,url:URL_BASE,key:'sb_publishable_test'});
      if(url.endsWith('/auth/v1/user'))return Response.json(user);
      if(url.includes('/auth/v1/token?'))return Response.json({access_token:'new-supabase-access',refresh_token:'new-supabase-refresh',expires_at:2100000000,user});
      if(url.endsWith('/auth/v1/logout?scope=local'))return Response.json({});
      if(url==='https://oauth2.googleapis.com/revoke')return new Response(null,{status:200});
      if(url.includes('/rest/v1/flow_workspaces'))return Response.json([{revision:1,data:{version:1,projects:[],tasks:[],preferences:{}}}]);
      if(url==='/api/google-token'){
        renewals++;if(holdRefresh)await new Promise(resolve=>{release=resolve;});
        return refreshResponse?Response.json(refreshResponse.body,{status:refreshResponse.status}):Response.json({accessToken:'renewed-google-access',expiresIn:3600});
      }
      if(url===gmail||url===agenda)return Response.json({ok:true},{status:googleUnauthorized&&options.headers.Authorization==='Bearer old-google-access'?401:200});
      throw new Error('Unexpected URL '+url);
    }};
  vm.createContext(context);vm.runInContext(readFileSync('cloud.js','utf8'),context);await context.FlowCloud.initialize();
  return {cloud:context.FlowCloud,values,calls,assigned,renewals:()=>renewals,release:()=>release(),stored:()=>JSON.parse(values.get(sessionKey))};
}
test('Gmail and Agenda share one renewal and retain it across reopening',async()=>{
  const c=await client();await Promise.all([c.cloud.googleFetch('gmail',gmail),c.cloud.googleFetch('calendar',agenda)]);
  assert.equal(c.renewals(),1);assert.equal(c.stored().gmailConnected,true);assert.equal(c.stored().calendarConnected,true);assert.equal(c.stored().provider_refresh_token,'test-google-refresh-token');assert.deepEqual(c.assigned,[]);
  const reopened=await client({values:c.values});await reopened.cloud.googleFetch('gmail',gmail);assert.equal(reopened.renewals(),0);assert.equal(reopened.cloud.calendarToken(),'renewed-google-access');
});
test('an unexpected Google 401 renews and retries once without redirecting to consent',async()=>{
  const c=await client({expired:false,googleUnauthorized:true});assert.equal((await c.cloud.googleFetch('gmail',gmail)).status,200);
  assert.equal(c.renewals(),1);assert.equal(c.calls.filter(call=>call.url===gmail).length,2);assert.deepEqual(c.assigned,[]);
});
test('refreshing the Supabase session preserves Google refresh credentials and both connections',async()=>{
  const c=await client({expired:false,supabaseExpired:true});assert.equal(c.stored().provider_refresh_token,'test-google-refresh-token');assert.equal(c.stored().provider_token,'old-google-access');assert.equal(c.stored().gmailConnected,true);assert.equal(c.stored().calendarConnected,true);assert.equal(c.renewals(),0);
});
test('a temporary refresh failure retains the saved connections and credential',async()=>{
  const c=await client({refreshResponse:{status:503,body:{code:'GOOGLE_REFRESH_NOT_CONFIGURED',error:'Configure OAuth'}}});
  await assert.rejects(c.cloud.googleFetch('gmail',gmail),/Configure OAuth/);assert.equal(c.stored().gmailConnected,true);assert.equal(c.stored().calendarConnected,true);assert.equal(c.stored().provider_refresh_token,'test-google-refresh-token');
});
test('a permanently revoked grant clears only the affected connection and requires new consent',async()=>{
  const c=await client({refreshResponse:{status:409,body:{code:'GOOGLE_RECONNECT_REQUIRED',error:'Grant revoked'}}});
  await assert.rejects(c.cloud.googleFetch('gmail',gmail),/Grant revoked/);assert.equal(c.stored().gmailConnected,false);assert.equal(c.stored().calendarConnected,true);assert.equal(c.stored().provider_refresh_token,null);
});
test('a renewal arriving after logout cannot restore a session or overwrite another account',async()=>{
  const c=await client({holdRefresh:true});const pending=c.cloud.ensureGoogleToken('gmail');
  while(!c.renewals())await new Promise(resolve=>setTimeout(resolve,0));
  await c.cloud.signOut();c.release();await assert.rejects(pending,/conta mudou/);assert.equal(c.values.has(sessionKey),false);
});
test('a renewal finishing after Gmail and Agenda were disconnected cannot bring the Google token back',async()=>{
  const c=await client({holdRefresh:true});const pending=c.cloud.ensureGoogleToken('gmail');
  while(!c.renewals())await new Promise(resolve=>setTimeout(resolve,0));
  c.cloud.disconnectGmail();c.cloud.disconnectCalendar();c.release();
  await assert.rejects(pending,/conexão ou a conta Google mudou/);
  assert.equal(c.stored().provider_token,undefined);assert.equal(c.stored().provider_refresh_token,undefined);
  assert.equal(c.calls.filter(call=>call.url==='https://oauth2.googleapis.com/revoke').length,2);
});
test('Google credentials cannot be sent to an unrelated URL',async()=>{
  const c=await client({expired:false});const count=c.calls.length;
  await assert.rejects(c.cloud.googleFetch('gmail','https://unrelated.example.test/'),/Destino Google/);assert.equal(c.calls.length,count);
});
test('OAuth asks for offline access and preserves the other connected integration',async()=>{
  const c=await client({expired:false});let proof;
  // PKCE needs browser crypto; inspect a fresh context with its browser equivalents.
  const source=readFileSync('cloud.js','utf8');
  const values=c.values,assigned=[];
  const context={URL,URLSearchParams,AbortSignal,TextEncoder,crypto:globalThis.crypto,btoa,sessionStorage:{setItem:(_,v)=>{proof=JSON.parse(v);}},location:{search:'',pathname:'/',hash:'',origin:'https://app.example.test',assign:url=>assigned.push(url)},window:{dispatchEvent(){},addEventListener(){}},CustomEvent:class{},setTimeout,clearTimeout,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetch:async url=>Response.json(url==='/api/auth-config'?{configured:true,url:URL_BASE,key:'public'}:url.endsWith('/auth/v1/user')?user:[])};
  vm.createContext(context);vm.runInContext(source,context);await context.FlowCloud.initialize();await context.FlowCloud.signIn('gmail');
  const query=new URL(assigned[0]).searchParams;assert.equal(query.get('access_type'),'offline');assert.equal(query.get('prompt'),'select_account');assert.ok(query.get('scopes').includes('calendar.events'));assert.ok(query.get('scopes').includes('gmail.modify'));assert.equal(proof.calendar,true);assert.equal(proof.gmail,true);
});
