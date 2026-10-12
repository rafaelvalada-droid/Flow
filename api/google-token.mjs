import {publicConfig} from './auth-config.mjs';

const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','pragma':'no-cache'}});
export function googleCredentials(env=process.env){
  return {id:(env.GOOGLE_CLIENT_ID||env.GOOGLE_OAUTH_CLIENT_ID||'').trim(),secret:(env.GOOGLE_CLIENT_SECRET||env.GOOGLE_OAUTH_CLIENT_SECRET||'').trim()};
}
export async function POST(request){
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(authorization))return json(401,{error:'Entre com Google no Ulbraflow.'});
  if(!(request.headers.get('content-type')||'').includes('application/json'))return json(415,{error:'Envie JSON.'});
  let config;
  try{config=publicConfig();if(!config.configured)throw new Error();}catch{return json(503,{error:'O acesso Google do Ulbraflow não está configurado.'});}
  const signal=AbortSignal.timeout(30000);
  try{
    const raw=await request.text();if(raw.length>10000)return json(413,{error:'Solicitação maior que o limite.'});
    let body;try{body=JSON.parse(raw);}catch{return json(400,{error:'Solicitação inválida.'});}
    if(!body||typeof body.refreshToken!=='string'||body.refreshToken.length<16||body.refreshToken.length>8192||/\s/.test(body.refreshToken))return json(400,{error:'Credencial Google inválida.'});
    const auth=await fetch(config.url+'/auth/v1/user',{headers:{apikey:config.key,authorization},signal});
    if(!auth.ok)return json(401,{error:'Sua sessão expirou. Entre novamente.'});
    const user=await auth.json();if(!/^[a-f0-9-]{36}$/i.test(user.id||''))return json(401,{error:'Conta inválida.'});
    const credentials=googleCredentials();
    if(!credentials.id||!credentials.secret)return json(503,{code:'GOOGLE_REFRESH_NOT_CONFIGURED',error:'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel, usando o mesmo cliente OAuth do Supabase, para renovar Gmail e Agenda automaticamente.'});
    const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials.id,client_secret:credentials.secret,refresh_token:body.refreshToken,grant_type:'refresh_token'}),signal});
    const data=await token.json().catch(()=>({}));
    if(!token.ok){
      if(data.error==='invalid_grant')return json(409,{code:'GOOGLE_RECONNECT_REQUIRED',error:'O Google encerrou a autorização. Conecte novamente para permitir a renovação automática.'});
      if(['invalid_client','unauthorized_client'].includes(data.error))return json(503,{code:'GOOGLE_REFRESH_NOT_CONFIGURED',error:'Confira GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel: precisam ser os mesmos do provedor Google no Supabase.'});
      return json(502,{error:'Não foi possível renovar o acesso do Google agora. Tente novamente em alguns instantes.'});
    }
    if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0)return json(502,{error:'O Google retornou uma renovação incompleta. Tente novamente.'});
    // A caller may only renew the Google identity verified by this Supabase account.
    const profileResponse=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{authorization:'Bearer '+data.access_token},signal});
    if(!profileResponse.ok)return json(502,{error:'Não foi possível conferir a conta Google após a renovação. Tente novamente.'});
    const profile=await profileResponse.json();
    const googleIdentities=(user.identities||[]).filter(identity=>identity.provider==='google');
    const subjects=googleIdentities.map(identity=>identity.identity_data?.sub||identity.identity_id).filter(Boolean);
    const matches=subjects.length?subjects.includes(profile.sub):typeof user.email==='string'&&profile.email_verified===true&&user.email.toLowerCase()===String(profile.email||'').toLowerCase();
    if(!matches)return json(409,{code:'GOOGLE_RECONNECT_REQUIRED',error:'Conecte Gmail e Agenda com a mesma conta Google do Ulbraflow.'});
    return json(200,{accessToken:data.access_token,expiresIn:Math.min(data.expires_in,86400),...(typeof data.refresh_token==='string'&&data.refresh_token?{refreshToken:data.refresh_token}:{}),...(typeof data.scope==='string'?{scope:data.scope}:{})});
  }catch{return json(502,{error:'A renovação do Google demorou ou perdeu a conexão. Tente novamente; suas conexões foram mantidas.'});}
}
