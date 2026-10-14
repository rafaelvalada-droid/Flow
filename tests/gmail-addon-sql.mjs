// Executa supabase/flow.sql + supabase/gmail-addon.sql num PostgreSQL descartável (PGlite), nunca num projeto real.
// Dependência opcional fora do checkout, como tests/schema-policy.mjs (veja docs/ATIVACAO-GOOGLE.md):
//   npm install --prefix /tmp/flow-sql-check @electric-sql/pglite@0.5.8 --ignore-scripts --no-audit --no-fund
//   FLOW_PGLITE_MODULE=/tmp/flow-sql-check/node_modules/@electric-sql/pglite/dist/index.js node tests/gmail-addon-sql.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if (!process.env.FLOW_PGLITE_MODULE) throw new Error('Set FLOW_PGLITE_MODULE to the installed PGlite module path.');
const {PGlite}=await import(process.env.FLOW_PGLITE_MODULE);
const db=new PGlite();
const a='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users (id uuid primary key);
 insert into auth.users values ('${a}'), ('${b}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
 grant usage on schema auth to authenticated;
 grant execute on function auth.uid() to authenticated;
`);
const sql=async name=>readFile(new URL('../supabase/'+name,import.meta.url),'utf8');
await db.exec(await sql('flow.sql'));
const addon=await sql('gmail-addon.sql');
await db.exec(addon);await db.exec(addon); // re-executável
let checks=0;const pass=message=>{checks++;console.log('PASS '+message);};
const as=async(role,uid='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);if(role)await db.exec('set role '+role);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const raw='0123456789abcdef'.repeat(4),other='fedcba9876543210'.repeat(4);
const thread='18b2c3d4e5f6a7b8',extensionThread='18b2c3d4e5f6a7b9',reviewThread='18b2c3d4e5f6a7ba';
await as('authenticated',a);
await db.query('select public.flow_save_workspace($1::jsonb,0)',[JSON.stringify({version:1,projects:[{id:'oferta',name:'Oferta'}],tasks:[{id:'ext',gmailThreadId:extensionThread,gmailCaptureId:'0b1c4a5e-1111-4222-8333-944455556666'},{id:'rev',gmailCaptureId:'gmail-review-'+reviewThread}]})]);
await as(null);await db.query("insert into public.flow_gmail_tokens(token_hash,user_id,expires_at) values($1,$2,now()-interval '1 day')",[hash(other),b]);
await as('authenticated',a);await db.query('select public.flow_create_gmail_token($1)',[hash(raw)]);
await as(null);
assert.deepEqual((await db.query('select user_id from public.flow_gmail_tokens')).rows.map(r=>r.user_id),[a]);
pass('Creating a connection stores only the SHA-256 and purges expired connections of every account');

const v2=(token,action,payload={})=>db.query('select public.flow_gmail_capture_v2($1,$2,$3::jsonb) as result',[token,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
const legacy=(tokenHash,action,payload={})=>db.query('select public.flow_gmail_capture($1,$2,$3::jsonb) as result',[tokenHash,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
await as('anon');
assert.deepEqual((await v2(raw,'areas')).projects,[{id:'oferta',name:'Oferta'}]);
await assert.rejects(()=>v2(hash(raw),'areas'),/Conexão vencida/);
await assert.rejects(()=>v2('not-a-token','areas'),/Conexão inválida/);
assert.deepEqual((await legacy(hash(raw),'areas')).projects,[{id:'oferta',name:'Oferta'}]);
pass('v2 accepts the raw key and hashes it in SQL; the stored hash is not a v2 credential; the legacy RPC still works for the transition');

const save=(over={})=>({title:'Turmas',projectId:'oferta',dueDate:'2026-10-20',gmailSubject:'Turmas',gmailSender:'coord@ulbra.br',captureId:'gmail-mobile-'+thread,gmailThreadId:thread,gmailMessageId:'18b2c3d4e5f6a7c0',gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+thread,...over});
const created=await v2(raw,'save',save());assert.ok(created.taskId&&!created.duplicate);
await as(null);const task=(await db.query('select data from public.flow_workspaces where user_id=$1',[a])).rows[0].data.tasks[0];
assert.equal(task.gmailThreadId,thread);assert.equal(task.gmailMessageId,'18b2c3d4e5f6a7c0');assert.equal(task.gmailCaptureId,'gmail-mobile-'+thread);
await as('anon');
assert.equal((await v2(raw,'save',save({captureId:'gmail-mobile-retry-'+thread}))).taskId,created.taskId);
assert.equal((await legacy(hash(raw),'save',save({captureId:'other-capture-id'}))).duplicate,true);
pass('A capture stores the hex thread and message IDs and the same thread never creates a second task');

const ext=await v2(raw,'save',save({captureId:'gmail-mobile-'+extensionThread,gmailThreadId:extensionThread,gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+extensionThread}));
assert.deepEqual(ext,{taskId:'ext',duplicate:true});
const rev=await v2(raw,'save',save({captureId:'gmail-mobile-'+reviewThread,gmailThreadId:undefined,gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+reviewThread}));
assert.deepEqual(rev,{taskId:'rev',duplicate:true});
pass('Threads captured by the Chrome extension (gmailThreadId) or by the Entrada review (gmail-review-<id>) are duplicates');

await assert.rejects(()=>v2(raw,'save',save({captureId:'gmail-mobile-thread-f-1',gmailThreadId:'thread-f:1781234567890123456',gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/thread-f:1781234567890123456'})),/Demanda inválida/);
await assert.rejects(()=>v2(raw,'save',save({gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/18B2C3D4E5F6A7B8'})),/Demanda inválida/);
await assert.rejects(()=>v2(raw,'save',save({gmailThreadId:'1111111111111111'})),/Conversa do Gmail inválida/);
const decimal=BigInt('0x'+'18b2c3d4e5f6a7bb').toString();// o complemento converte thread-f:<decimal> para este hexadecimal
const converted=await v2(raw,'save',save({captureId:'gmail-mobile-18b2c3d4e5f6a7bb',gmailThreadId:BigInt(decimal).toString(16),gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+BigInt(decimal).toString(16)}));
assert.ok(converted.taskId&&!converted.duplicate);
pass('Only lowercase hex thread IDs are accepted; a thread-f decimal converted to hex is saved');

await as(null);await db.query("update public.flow_gmail_tokens set expires_at=now()-interval '1 second'");
await as('anon');await assert.rejects(()=>v2(raw,'areas'),/Conexão vencida/);
// A recusa desfaz a transação; a limpeza acontece na próxima validação ou criação bem-sucedida.
await as(null);await db.query('insert into public.flow_gmail_tokens(token_hash,user_id) values($1,$2)',[hash(other),a]);
await as('anon');assert.equal((await v2(other,'areas')).projects.length,1);
await as(null);assert.deepEqual((await db.query('select token_hash from public.flow_gmail_tokens')).rows.map(r=>r.token_hash),[hash(other)]);
pass('An expired connection is rejected and purged by the next successful validation');

for(const role of ['anon','authenticated']){
 await as(role,a);
 await assert.rejects(()=>db.query("select public.flow_gmail_capture_apply($1,'areas','{}'::jsonb)",[a]),/permission denied/);
 await assert.rejects(()=>db.query('select public.flow_gmail_token_owner($1)',[hash(raw)]),/permission denied/);
 await assert.rejects(()=>db.query('select * from public.flow_gmail_tokens'),/permission denied/);
}
await as(null);
const definer=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname like 'flow_%gmail%' order by proname")).rows;
for(const row of definer){assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.prosecdef,['flow_gmail_capture','flow_gmail_capture_v2','flow_create_gmail_token','flow_revoke_gmail_token'].includes(row.proname),row.proname);}
pass('Internal functions are not executable by anon/authenticated; public RPCs keep security definer and an empty search_path');
await db.close();
console.log(checks+' Gmail add-on SQL checks passed in disposable PGlite; no live Supabase claim.');
