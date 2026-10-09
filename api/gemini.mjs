import { timingSafeEqual } from 'node:crypto';

const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const eq=(a,b)=>{const aa=Buffer.from(a);const bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);};

// Endpoint fechado por padrão: só ativa com DUAS credenciais secretas na Vercel.
export async function POST(request){
  if(!process.env.GEMINI_API_KEY || !process.env.FLOW_AI_ACCESS_TOKEN){return json(503,{error:'Gemini não configurado. Defina GEMINI_API_KEY e FLOW_AI_ACCESS_TOKEN no servidor.'});}
  if(!eq(request.headers.get('x-flow-access-token')||'',process.env.FLOW_AI_ACCESS_TOKEN))return json(401,{error:'Senha de acesso ao assistente inválida.'});
  if(!(request.headers.get('content-type')||'').includes('application/json'))return json(415,{error:'Envie um JSON.'});
  let body;
  try{body=await request.json()}catch{return json(400,{error:'JSON inválido.'})}
  const {mode,title,description}=body||{};
  if(!['improve','reply','subtasks'].includes(mode)||typeof title!=='string'||typeof description!=='string'||!description.trim())return json(400,{error:'Informe ação, título e texto.'});
  if(title.length>300 || description.length>7500)return json(413,{error:'Texto maior que o limite permitido.'});
  const instructions={
    improve:'Reescreva a descrição desta tarefa em português do Brasil com clareza, profissionalismo e fidelidade aos fatos. Preserve datas, nomes e pendências sem inventar informações. Apresente objetivo, contexto e próximos passos. Retorne apenas o texto melhorado.',
    reply:'Crie um rascunho de resposta profissional por e-mail em português do Brasil baseado no contexto. Não alegue que uma tarefa foi concluída se não houver confirmação. Não invente prazos, aprovações ou encaminhamentos. Retorne somente o rascunho, com saudação e encerramento.',
    subtasks:'Proponha até 6 subtarefas objetivas e executáveis, uma por linha. Não invente fatos. Retorne apenas linhas de subtarefas sem numeração, sem título e sem marcadores.'
  };
  const input=`${instructions[mode]}\n\nTarefa: ${title}\n\nInformações fornecidas:\n${description}`;
  try{
    const abort=AbortSignal.timeout(35000);
    const result=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',signal:abort,
      headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',input,store:false})
    });
    const payload=await result.json().catch(()=>({}));
    if(!result.ok){return json(502,{error:`Gemini não respondeu corretamente (HTTP ${result.status}). Confira a chave, o modelo e a cota da API.`})}
    const text=(payload.steps||[]).filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
    if(!text)return json(502,{error:'O Gemini retornou uma resposta sem texto utilizável.'});
    return json(200,{text});
  }catch(err){return json(502,{error:err?.name==='TimeoutError'?'O Gemini excedeu o tempo de resposta.':'Falha ao acessar a API Gemini.'});}
}
