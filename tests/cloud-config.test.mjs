import test from 'node:test';
import assert from 'node:assert/strict';
import {publicConfig} from '../api/auth-config.mjs';
const jwt = role => 'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
test('unconfigured local mode is explicit; required or partial auth fails closed',()=>{
  assert.deepEqual(publicConfig({}),{configured:false});
  assert.throws(()=>publicConfig({FLOW_REQUIRE_AUTH:'true'}));
  assert.throws(()=>publicConfig({SUPABASE_URL:'https://project.supabase.co'}));
});
test('client config accepts publishable/anon keys and rejects private keys and unsafe URLs',()=>{
  for(const key of ['sb_publishable_publicTest',jwt('anon')])
    assert.equal(publicConfig({SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:key}).configured,true);
  for(const key of ['sb_secret_privateTest',jwt('service_role'),'invalid'])
    assert.throws(()=>publicConfig({SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:key}));
  for(const url of ['http://project.supabase.co','https://user:password@project.supabase.co','https://project.supabase.co/path'])
    assert.throws(()=>publicConfig({SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}));
});
