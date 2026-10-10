// Run against a disposable PGlite PostgreSQL instance, never a production project.
// Optional dependency lives outside this checkout; see docs/ATIVACAO-GOOGLE.md.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
if (!process.env.FLOW_PGLITE_MODULE) throw new Error('Set FLOW_PGLITE_MODULE to the installed PGlite module path.');
const {PGlite} = await import(process.env.FLOW_PGLITE_MODULE);
const db = new PGlite();
const a='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', b='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${a}'), ('${b}');
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
const schema=await readFile(new URL('../supabase/flow.sql',import.meta.url),'utf8');
await db.exec(schema);
await db.exec(schema); // Repeat setup safely.
const workspace={version:1,projects:[],tasks:[{id:'private-a'}]};
const save=async(data,rev)=>db.query('select public.flow_save_workspace($1::jsonb,$2::integer) as result',[JSON.stringify(data),rev]);
const identity=async(uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
await identity(a);
assert.equal((await save(workspace,0)).rows[0].result.revision,1);
assert.equal((await db.query('select * from public.flow_workspaces')).rows.length,1);
await assert.rejects(()=>db.query('insert into public.flow_workspaces(user_id,data) values($1,$2)',[b,JSON.stringify(workspace)]),/permission denied/);
await assert.rejects(()=>db.query('update public.flow_workspaces set data=$1',[JSON.stringify(workspace)]),/permission denied/);
console.log('PASS authenticated users can save their own workspace but cannot write directly to the table');
await identity(b);
assert.equal((await db.query('select * from public.flow_workspaces')).rows.length,0);
const bob={version:1,projects:[],tasks:[{id:'private-b'}],user_id:a};
assert.equal((await save(bob,0)).rows[0].result.revision,1);
const own=(await db.query('select * from public.flow_workspaces')).rows;
assert.equal(own.length,1);assert.equal(own[0].user_id,b);
console.log('PASS RLS hides other accounts and the RPC derives ownership from authenticated identity');
await identity(a);
assert.equal((await db.query('select data from public.flow_workspaces')).rows[0].data.tasks[0].id,'private-a');
assert.equal((await save(workspace,1)).rows[0].result.revision,2);
await assert.rejects(()=>save(workspace,1),/Workspace revision conflict/);
assert.equal((await db.query('select revision from public.flow_workspaces')).rows[0].revision,2);
console.log('PASS stale revisions fail atomically without replacing saved work');
await assert.rejects(()=>save({version:1,projects:[],tasks:null},2),/Invalid Flow workspace/);
await db.query("select set_config('request.jwt.claim.sub','',false)");
await assert.rejects(()=>save(workspace,0),/Authentication required/);
await db.exec('reset role; set role anon');
await assert.rejects(()=>db.query('select * from public.flow_workspaces'),/permission denied/);
await assert.rejects(()=>save(workspace,0),/permission denied/);
console.log('PASS anonymous, missing-identity and malformed requests are rejected');
await db.close();
console.log('4 PostgreSQL policy checks passed in disposable PGlite; no live Supabase claim.');
