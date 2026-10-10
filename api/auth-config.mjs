// Only the public Supabase client key may leave this endpoint.
export function publicConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  if (!url && !key && env.FLOW_REQUIRE_AUTH !== 'true') return {configured: false};
  let parsed;
  try { parsed = new URL(url); } catch {}
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
  }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || !publicKey) {
    throw new Error('Configure SUPABASE_URL e a chave publicável do Supabase na Vercel.');
  }
  return {configured: true, url: parsed.origin, key};
}

export function GET() {
  try {
    return Response.json(publicConfig(), {headers: {'cache-control': 'no-store'}});
  } catch (error) {
    return Response.json({error: error.message}, {status: 503, headers: {'cache-control': 'no-store'}});
  }
}
