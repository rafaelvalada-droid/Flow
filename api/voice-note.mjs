// Lembretes de voz da Entrada: transcrição do áudio gravado no navegador e melhoria do texto com Gemini.
// Mesma conta, regras de acesso (FLOW_ALLOWED_EMAILS) e cota diária da análise de e-mails.
import {publicConfig,accountAccess} from './auth-config.mjs';
import {consumeAiQuota,geminiFailure} from './gmail-review.mjs';
const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
// Até ~3 minutos de áudio compactado em base64; o corpo da Vercel aceita até 4,5 MB.
export const MAX_BODY=4000000;
const AUDIO=['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/aac','audio/x-m4a'];
const schema={type:'OBJECT',properties:{text:{type:'STRING'},title:{type:'STRING'}},required:['text','title']};
const INSTRUCTIONS={
 transcribe:'Transcreva fielmente o áudio em português do Brasil. É um lembrete de trabalho ditado pelo usuário. Retorne JSON com text (a transcrição com pontuação, sem inventar nem resumir; remova apenas hesitações como "é…", "hum", "tipo assim") e title (título curto e acionável de até 80 caracteres, começando por um verbo no infinitivo quando possível). Se não houver fala, retorne text e title vazios.',
 improve:'Reescreva o lembrete do usuário em português do Brasil, claro e organizado, sem inventar informações, pessoas, prazos ou valores e mantendo nomes, datas e números. Use frases curtas ou tópicos quando houver vários itens. Retorne JSON com text (o lembrete reescrito) e title (título curto e acionável de até 80 caracteres, começando por um verbo no infinitivo quando possível).'
};
export function parseVoiceBody(raw){
 if(raw.length>MAX_BODY)return {status:413,error:'Gravação longa demais. Grave lembretes de até 3 minutos.'};
 let body;try{body=JSON.parse(raw);}catch{return {status:400,error:'JSON inválido.'};}
 if(body?.mode==='transcribe'){
  const mimeType=String(body.mimeType||'').split(';')[0].trim().toLowerCase();
  if(!AUDIO.includes(mimeType))return {status:400,error:'Formato de áudio não suportado.'};
  if(typeof body.audio!=='string'||body.audio.length<100||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))return {status:400,error:'Áudio inválido ou vazio.'};
  return {mode:'transcribe',mimeType,audio:body.audio};
 }
 if(body?.mode==='improve'){
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>8000)return {status:400,error:'Escreva o lembrete (até 8.000 caracteres) antes de melhorar.'};
  return {mode:'improve',text:body.text};
 }
 return {status:400,error:'Ação inválida.'};
}
export async function POST(request){
 const deadline=AbortSignal.timeout(55000);
 const signal=ms=>AbortSignal.any([deadline,AbortSignal.timeout(ms)]);
 if(!process.env.GEMINI_API_KEY)return json(503,{error:'Configure GEMINI_API_KEY na Vercel para transcrever lembretes.'});
 let config;try{config=publicConfig();if(!config.configured)throw new Error();}catch{return json(503,{error:'O acesso Google do UlbraFlow não está configurado.'});}
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(authorization))return json(401,{error:'Entre com Google no UlbraFlow para transcrever.'});
 try{
  const auth=await fetch(config.url+'/auth/v1/user',{headers:{apikey:config.key,authorization},signal:signal(12000)});
  if(!auth.ok)return json(401,{error:'Sua sessão expirou. Entre novamente.'});
  const user=await auth.json().catch(()=>null);if(!user?.id)return json(401,{error:'Conta inválida.'});
  const access=accountAccess(user);if(!access.ok)return json(access.status,{error:access.error});
  if(!(request.headers.get('content-type')||'').includes('application/json'))return json(415,{error:'Envie JSON.'});
  const body=parseVoiceBody(await request.text());if(body.error)return json(body.status,{error:body.error});
  const quota=await consumeAiQuota(config,authorization,signal(12000));if(!quota.ok)return json(quota.status,{error:quota.error});
  const model=(process.env.GEMINI_REVIEW_MODEL||'gemini-2.5-flash').trim().replace(/^models\//,'');
  const parts=body.mode==='transcribe'?[{inlineData:{mimeType:body.mimeType,data:body.audio}},{text:'Transcreva este lembrete de voz.'}]:[{text:body.text}];
  const result=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY.trim()},signal:signal(45000),
   body:JSON.stringify({systemInstruction:{parts:[{text:INSTRUCTIONS[body.mode]}]},contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:body.mode==='transcribe'?0:0.3,maxOutputTokens:8000}})});
  // 400 numa transcrição costuma ser formato recusado: o navegador reenvia a gravação convertida em WAV.
  if(!result.ok){const failure=await result.json().catch(()=>({}));return json(502,{error:geminiFailure(result.status,failure),upstreamStatus:result.status,...(body.mode==='transcribe'&&result.status===400?{code:'audio-format'}:{})});}
  const response=await result.json();
  const content=response.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
  let value;try{value=JSON.parse(content.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{return json(502,{error:'O Gemini não devolveu o texto. Tente novamente.'});}
  const text=String(value?.text||'').trim().slice(0,7500),title=String(value?.title||'').trim().slice(0,180);
  if(!text)return json(422,body.mode==='transcribe'?{error:'Não foi reconhecida nenhuma fala na gravação. Grave de novo, mais perto do microfone.',code:'no-speech'}:{error:'O Gemini não conseguiu reescrever o lembrete.'});
  return json(200,{text,title,modelUsed:model});
 }catch(error){return json(502,{error:deadline.aborted||['TimeoutError','AbortError'].includes(error?.name)?'O Gemini demorou demais para responder. Tente novamente.':'Falha ao processar o lembrete. Tente novamente.'});}
}
