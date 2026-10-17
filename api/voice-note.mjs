// Criar demanda com Gemini (Entrada): o usuário fala ou escreve o pedido, a área e o prazo; o Gemini devolve
// título, descrição, área (da lista enviada) e prazo resolvido no calendário. Mesma conta, FLOW_ALLOWED_EMAILS e cota diária.
import {publicConfig,accountAccess} from './auth-config.mjs';
import {consumeAiQuota,geminiFailure} from './gmail-review.mjs';
const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
// Até ~3 minutos de áudio compactado em base64; o corpo da Vercel aceita até 4,5 MB.
export const MAX_BODY=4000000;
const AUDIO=['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/aac','audio/x-m4a'];
const WEEKDAYS=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
const schema={type:'OBJECT',properties:{transcript:{type:'STRING'},title:{type:'STRING'},description:{type:'STRING'},areaId:{type:'STRING'},dueDate:{type:'STRING'},dateEvidence:{type:'STRING'},subtasks:{type:'ARRAY',items:{type:'STRING'}}},required:['transcript','title','description','areaId','dueDate','dateEvidence','subtasks']};
const INSTRUCTION='Você cria uma demanda de trabalho no UlbraFlow a partir do que o próprio usuário falou (áudio) ou escreveu, em português do Brasil. O usuário dita nesta ordem combinada: 1) o nome da demanda; 2) a descrição; 3) a classificação, isto é, a área; 4) a data do prazo; e, se quiser, 5) as subtarefas, anunciadas por "subtarefas", "criar subtarefas" ou "etapas" e enumeradas ("um..., dois...", "primeiro..., segundo..." ou separadas por pausas). Use essa ordem para separar as partes, mas aceite as informações fora de ordem e expressões como "o nome é", "descrição", "área" ou "prazo". Retorne JSON com: transcript (o que foi dito, transcrito fielmente com pontuação; para texto, repita o texto); title (o nome da demanda como o usuário disse, só com pontuação e maiúscula corrigidas, até 120 caracteres, sem a área, o prazo e as subtarefas; se ele não disse um nome claro, crie um título curto e acionável começando por um verbo no infinitivo); description (a descrição dita, organizada em frases curtas, sem inventar pessoas, valores, prazos ou fatos e sem repetir o nome, a área, o prazo e as subtarefas; vazio se ele não descreveu); areaId (o id da área em areas que o usuário nomeou ou que corresponde claramente ao que ele disse, mesmo com nome abreviado; vazio se ele não indicou área ou se houver dúvida entre áreas); dueDate (AAAA-MM-DD do prazo final que o usuário disse, resolvido com hoje e calendario, por exemplo "sexta" é a próxima sexta-feira a partir de hoje, "amanhã" é o dia seguinte, "dia 25" é o próximo dia 25; vazio se ele não disse prazo); dateEvidence (as palavras exatas ditas sobre o prazo, ou vazio); subtasks (cada subtarefa enumerada pelo usuário, na ordem dita, como frase curta começando por um verbo no infinitivo quando possível, sem a numeração; lista vazia se ele não pediu subtarefas; nunca invente subtarefas). Se não houver fala nem pedido, retorne todos os campos vazios.';
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value};
// Calendário dos próximos dias, para o Gemini não errar a conta de "sexta que vem" ou "dia 5".
export function calendar(today,days=70){
 const start=new Date(today+'T12:00:00Z');
 return Array.from({length:days},(_,i)=>{const date=new Date(start.getTime()+i*86400000);return date.toISOString().slice(0,10)+' '+WEEKDAYS[date.getUTCDay()]});
}
export function parseVoiceBody(raw){
 if(raw.length>MAX_BODY)return {status:413,error:'Gravação longa demais. Grave demandas de até 3 minutos.'};
 let body;try{body=JSON.parse(raw);}catch{return {status:400,error:'JSON inválido.'};}
 if(body?.mode!=='demand')return {status:400,error:'Ação inválida.'};
 if(!validDate(body.today))return {status:400,error:'Data de hoje inválida.'};
 if(!Array.isArray(body.areas)||body.areas.length>100||body.areas.some(a=>!a||typeof a.id!=='string'||!a.id||a.id.length>100||typeof a.name!=='string'||a.name.length>150))return {status:400,error:'Áreas inválidas.'};
 const areas=body.areas.map(({id,name})=>({id,name}));
 if(body.audio!==undefined){
  const mimeType=String(body.mimeType||'').split(';')[0].trim().toLowerCase();
  if(!AUDIO.includes(mimeType))return {status:400,error:'Formato de áudio não suportado.'};
  if(typeof body.audio!=='string'||body.audio.length<100||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))return {status:400,error:'Áudio inválido ou vazio.'};
  return {today:body.today,areas,mimeType,audio:body.audio};
 }
 if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)return {status:400,error:'Escreva a demanda (até 4.000 caracteres).'};
 return {today:body.today,areas,text:body.text};
}
export function validateDemand(value,body){
 const text=key=>typeof value?.[key]==='string'?value[key].trim():'';
 const dueDate=validDate(text('dueDate'))?text('dueDate'):'';
 const subtasks=(Array.isArray(value?.subtasks)?value.subtasks:[]).filter(item=>typeof item==='string').map(item=>item.trim().slice(0,180)).filter(Boolean).slice(0,30);
 return {title:text('title').slice(0,180),description:text('description').slice(0,7500),transcript:text('transcript').slice(0,7500),areaId:body.areas.some(a=>a.id===text('areaId'))?text('areaId'):'',dueDate,dateEvidence:dueDate?text('dateEvidence').slice(0,200):'',subtasks};
}
export async function POST(request){
 const deadline=AbortSignal.timeout(55000);
 const signal=ms=>AbortSignal.any([deadline,AbortSignal.timeout(ms)]);
 if(!process.env.GEMINI_API_KEY)return json(503,{error:'Configure GEMINI_API_KEY na Vercel para criar demandas com Gemini.'});
 let config;try{config=publicConfig();if(!config.configured)throw new Error();}catch{return json(503,{error:'O acesso Google do UlbraFlow não está configurado.'});}
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(authorization))return json(401,{error:'Entre com Google no UlbraFlow para criar demandas com Gemini.'});
 try{
  const auth=await fetch(config.url+'/auth/v1/user',{headers:{apikey:config.key,authorization},signal:signal(12000)});
  if(!auth.ok)return json(401,{error:'Sua sessão expirou. Entre novamente.'});
  const user=await auth.json().catch(()=>null);if(!user?.id)return json(401,{error:'Conta inválida.'});
  const access=accountAccess(user);if(!access.ok)return json(access.status,{error:access.error});
  if(!(request.headers.get('content-type')||'').includes('application/json'))return json(415,{error:'Envie JSON.'});
  const body=parseVoiceBody(await request.text());if(body.error)return json(body.status,{error:body.error});
  const quota=await consumeAiQuota(config,authorization,signal(12000));if(!quota.ok)return json(quota.status,{error:quota.error});
  const model=(process.env.GEMINI_REVIEW_MODEL||'gemini-2.5-flash').trim().replace(/^models\//,'');
  const context=JSON.stringify({hoje:body.today+' '+WEEKDAYS[new Date(body.today+'T12:00:00Z').getUTCDay()],calendario:calendar(body.today),areas:body.areas,...(body.text?{texto:body.text}:{})});
  const parts=body.audio?[{inlineData:{mimeType:body.mimeType,data:body.audio}},{text:'Crie a demanda a partir deste áudio. Contexto: '+context}]:[{text:'Crie a demanda a partir deste texto. Contexto: '+context}];
  const result=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY.trim()},signal:signal(45000),
   body:JSON.stringify({systemInstruction:{parts:[{text:INSTRUCTION}]},contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0,maxOutputTokens:8000}})});
  // 400 com áudio costuma ser formato recusado: o navegador reenvia a gravação convertida em WAV.
  if(!result.ok){const failure=await result.json().catch(()=>({}));return json(502,{error:geminiFailure(result.status,failure),upstreamStatus:result.status,...(body.audio&&result.status===400?{code:'audio-format'}:{})});}
  const response=await result.json();
  const content=response.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
  let value;try{value=JSON.parse(content.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{return json(502,{error:'O Gemini não devolveu a demanda. Tente novamente.'});}
  const demand=validateDemand(value,body);
  if(!demand.title)return json(422,body.audio?{error:'Não foi reconhecida nenhuma fala na gravação. Grave de novo, mais perto do microfone.',code:'no-speech'}:{error:'O Gemini não entendeu a demanda. Escreva o que precisa ser feito.'});
  return json(200,{...demand,modelUsed:model});
 }catch(error){return json(502,{error:deadline.aborted||['TimeoutError','AbortError'].includes(error?.name)?'O Gemini demorou demais para responder. Tente novamente.':'Falha ao criar a demanda. Tente novamente.'});}
}
