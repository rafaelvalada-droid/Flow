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

// Rotas com sessão Supabase só atendem identidades Google e, se FLOW_ALLOWED_EMAILS existir, apenas os e-mails/domínios listados.
export function accountAccess(user, env = process.env) {
  const google = (Array.isArray(user?.identities) ? user.identities : []).filter(identity => identity?.provider === 'google');
  const providers = [user?.app_metadata?.provider, ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [])];
  if (!google.length && !providers.includes('google')) return {ok: false, status: 403, error: 'Entre com uma conta Google para usar este recurso do UlbraFlow.'};
  const rules = String(env.FLOW_ALLOWED_EMAILS || '').split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return {ok: true};
  // Vale o e-mail confirmado da identidade Google; o e-mail principal só quando o Supabase não detalha as identidades.
  const emails = [...google.filter(identity => identity.identity_data?.email_verified !== false).map(identity => identity.identity_data?.email), ...(google.length ? [] : [user.email])]
    .filter(email => typeof email === 'string' && /^[^@\s]+@[^@\s]+$/.test(email.trim())).map(email => email.trim().toLowerCase());
  const allowed = emails.some(email => rules.some(rule => rule.includes('@') && !rule.startsWith('@') ? email === rule : email.endsWith('@' + rule.replace(/^@/, ''))));
  return allowed ? {ok: true} : {ok: false, status: 403, error: 'Esta conta Google não está autorizada no UlbraFlow. Peça a liberação ao responsável.'};
}

export function GET() {
  try {
    const googleRefreshConfigured=!!((process.env.GOOGLE_CLIENT_ID||process.env.GOOGLE_OAUTH_CLIENT_ID||'').trim()&&(process.env.GOOGLE_CLIENT_SECRET||process.env.GOOGLE_OAUTH_CLIENT_SECRET||'').trim());
    // Somente configuração pública; a CDN guarda por 1 h e cada deploy (único jeito de mudar variáveis) limpa o cache.
    return Response.json({...publicConfig(),googleRefreshConfigured}, {headers: {'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'}});
  } catch (error) {
    return Response.json({error: error.message}, {status: 503, headers: {'cache-control': 'no-store'}});
  }
}
