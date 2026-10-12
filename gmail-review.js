/* Raw message bodies remain in memory; only reviews are saved. */
(() => {
 'use strict';
 let emails=[],nextPage='',loading=false,analyzing=false,analysisBlocked=false,error='',analysisError='',owner='',generation=0,verifiedHistory='',analysisEpoch=0,completed=0;
 const emit=(emailsChanged=false)=>window.dispatchEvent(new CustomEvent('flow:gmail-review',{detail:{emailsChanged}}));
 const decode=value=>{try{return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));}catch{return '';}};
 function bodyText(part){
  const plain=[],html=[];
  function walk(p){if(p.filename)return;if(p.body?.data){if(p.mimeType==='text/plain')plain.push(decode(p.body.data));if(p.mimeType==='text/html')html.push(decode(p.body.data));}for(const child of p.parts||[])walk(child);}
  walk(part);if(plain.length)return plain.join('\n');
  const parsed=new DOMParser().parseFromString(html.join('\n').replace(/<(img|iframe|link|video|audio|source|object|embed)\b[^>]*>/gi,''),'text/html');parsed.querySelectorAll('script,style').forEach(n=>n.remove());return parsed.body.textContent||'';
 }
 const header=(m,name)=>m.payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
 async function api(path,method='GET',body){
  const token=FlowCloud.gmailToken();if(!token)throw new Error('Conecte a leitura do Gmail.');
  let response;try{const url='https://gmail.googleapis.com/gmail/v1/users/me/'+path,options={method,headers:{Authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(path==='messages/send'?45000:15000)};response=FlowCloud.googleFetch?await FlowCloud.googleFetch('gmail',url,options):await fetch(url,options);}catch(failure){if(failure.googleAuthorization)throw failure;throw new Error(path==='messages/send'?'O Gmail não confirmou o envio. Confira Enviados antes de tentar novamente.':'A leitura do Gmail demorou ou perdeu a conexão. Clique em Atualizar e-mails para tentar novamente.');}
  const result=await response.json().catch(()=>({}));
  if(response.status===401){FlowCloud.disconnectGmail();throw new Error('A autorização do Gmail expirou. Clique em Conectar leitura do Gmail novamente.');}
  if(response.status===403){
   const reasons=[...(result.error?.details||[]).map(d=>d.reason),...(result.error?.errors||[]).map(d=>d.reason)];
   if(reasons.some(r=>['SERVICE_DISABLED','accessNotConfigured','API_DISABLED'].includes(r))||/has not been used|is disabled|not enabled/i.test(result.error?.message||''))throw new Error('O acesso foi autorizado, mas a Gmail API está desativada. No Google Cloud do projeto Flow, abra APIs e serviços → Biblioteca → Gmail API → Ativar. Depois clique em Atualizar e-mails.');
   if(reasons.includes('insufficientPermissions')||reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')){FlowCloud.disconnectGmail();throw new Error('O Google não liberou a leitura da caixa de entrada. Conecte o Gmail novamente e autorize as permissões solicitadas.');}
   const reason=reasons.filter(r=>typeof r==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(r)).join(', ')||String(result.error?.status||'PERMISSION_DENIED').replace(/[^a-zA-Z0-9_]/g,'').slice(0,80);
   if(reasons.some(r=>['domainPolicy','DOMAIN_POLICY_VIOLATION','ORG_RESTRICTION_VIOLATION'].includes(r))||/administrator|admin policy|domain policy|organization policy/i.test(result.error?.message||''))throw new Error('A política da conta Google bloqueou o Gmail no Ulbraflow (HTTP 403; '+reason+'). Peça ao administrador da conta @ulbra.br para verificar o acesso OAuth do Ulbraflow ao Gmail.');
   throw new Error('O Google bloqueou a leitura do Gmail (HTTP 403; '+reason+'). Conecte novamente e confira se todas as permissões solicitadas foram autorizadas.');
  }
  if(response.status===429)throw new Error('O Gmail atingiu o limite de consultas. Aguarde um momento e tente novamente.');
  if(!response.ok){const failure=new Error('Não foi possível acessar o Gmail (HTTP '+response.status+'). Tente novamente.');failure.status=response.status;throw failure;}
  return result;
 }

 // A stable mailbox history ID avoids downloading the same 25 conversations every poll.
 async function changedThreads(historyId){
  const changed=new Set();let page='';
  for(let count=0;count<5;count++){
   const query=new URLSearchParams({startHistoryId:historyId,maxResults:'100'});if(page)query.set('pageToken',page);
   const result=await api('history?'+query);
   for(const record of result.history||[])for(const item of [...(record.messages||[]),...(record.messagesAdded||[]),...(record.messagesDeleted||[]),...(record.labelsAdded||[]),...(record.labelsRemoved||[])]){const id=item.threadId||item.message?.threadId;if(id)changed.add(id);}
   page=result.nextPageToken||'';if(!page)return changed;
  }
  return null; // A large or expired history falls back to a complete refresh.
 }
 async function refresh(more=false){
  if(loading)return;const id=++generation,currentOwner=FlowCloud.info().user?.id||'';
  if(owner!==currentOwner){emails=[];nextPage='';verifiedHistory='';}
  owner=currentOwner;loading=true;error='';emit();
  const valid=()=>id===generation&&currentOwner===FlowCloud.info().user?.id&&!!FlowCloud.gmailToken();
  try{
   const profile=await api('profile');if(profile.emailAddress?.toLowerCase()!==FlowCloud.info().user?.email?.toLowerCase())throw new Error('Conecte o Gmail da mesma conta usada no Ulbraflow.');
   if(!valid())return;
   if(!more&&verifiedHistory&&profile.historyId===verifiedHistory)return;
   let changed=null;
   if(!more&&verifiedHistory&&profile.historyId){try{changed=await changedThreads(verifiedHistory);}catch(e){if(e.status!==404)throw e;}}
   const cached=new Map(emails.map(email=>[email.id,email])),collected=[];
   const target=more?25:Math.max(25,emails.length);let page=more?nextPage:'';
   do{
    const params=new URLSearchParams({labelIds:'INBOX',maxResults:'25'});if(page)params.set('pageToken',page);
    const list=await api('threads?'+params),pending=list.threads||[];let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{while(cursor<pending.length){const thread=pending[cursor++];
     if(!valid())return;
     let item=cached.get(thread.id);
     if(!item||changed===null||changed.has(thread.id)){
      const result=await api('threads/'+encodeURIComponent(thread.id)+'?format=full');if(!valid())return;
      const messages=result.messages||[],latest=messages.filter(m=>!m.labelIds?.includes('SENT')||m.labelIds?.includes('INBOX')).at(-1);if(!latest)continue;
      const text=messages.slice(-3).map(m=>'De: '+header(m,'From')+'\nAssunto: '+header(m,'Subject')+'\n'+bodyText(m.payload)).join('\n\n');
      item={id:thread.id,messageId:latest.id,subject:header(latest,'Subject')||'(Sem assunto)',sender:header(latest,'From'),recipient:header(latest,'To'),rfcMessageId:header(latest,'Message-ID'),references:header(latest,'References'),snippet:latest.snippet||'',text:text.slice(-12000),truncated:text.length>12000||messages.length>3,date:Number(latest.internalDate),gmailUrl:'https://mail.google.com/mail/?authuser='+encodeURIComponent(profile.emailAddress)+'#all/'+thread.id};
     }
     collected.push(item);
     if(valid()){const index=emails.findIndex(e=>e.id===item.id),updated=index<0||emails[index].messageId!==item.messageId;if(index<0)emails.push(item);else emails[index]=item;if(updated)emit(true);}
    }}));
    if(!valid())return;page=list.nextPageToken||'';
   }while(!more&&page&&collected.length<target);
   if(!valid())return;
   emails=(more?[...emails.filter(e=>!collected.some(n=>n.id===e.id)),...collected]:collected).sort((a,b)=>b.date-a.date);nextPage=page;
   // Loading another page does not prove older cached pages were refreshed.
   if(!more){verifiedHistory=profile.historyId||'';}
  }catch(e){if(id===generation&&currentOwner===FlowCloud.info().user?.id)error=e.message;}finally{if(id===generation){loading=false;emit();}}
 }
 async function analyze(db,persist,force=false){
  if(analyzing||(!force&&analysisBlocked)||!FlowCloud.gmailToken()||!emails.length)return;
  if(!emails.some(email=>db.gmailReviews?.[email.id]?.messageId!==email.messageId))return;
  analysisBlocked=false;const currentOwner=FlowCloud.info().user?.id,epoch=analysisEpoch;
  const valid=()=>epoch===analysisEpoch&&currentOwner===FlowCloud.info().user?.id&&!!FlowCloud.gmailToken();
  analyzing=true;completed=0;analysisError='';emit();
  try{
   db.gmailReviews??={};
   // Pick the next pending message after each result so newly arrived messages join this queue.
   while(valid()){
    const email=emails.find(email=>db.gmailReviews[email.id]?.messageId!==email.messageId);if(!email)break;
    const review=await FlowCloud.analyzeGmail({subject:email.subject.slice(0,300),text:email.text||email.snippet,areas:db.projects.map(p=>({id:p.id,name:p.name}))});
    if(!valid())return;
    if(emails.find(e=>e.id===email.id)?.messageId!==email.messageId||db.gmailReviews[email.id]?.messageId===email.messageId)continue;
    db.gmailReviews[email.id]={...review,messageId:email.messageId,state:'pending'};completed++;persist();emit();
   }
  }catch(e){if(valid()){analysisError=e.message;analysisBlocked=true;}}finally{if(epoch===analysisEpoch){analyzing=false;emit();}}
 }
 function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
 function address(value){const match=String(value||'').match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+/);return match?.[0]||'';}
 async function replyContext(threadId){
  const cached=emails.find(e=>e.id===threadId);if(cached)return cached;
  const thread=await api('threads/'+encodeURIComponent(threadId)+'?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References');const m=thread.messages?.at(-1);if(!m)throw new Error('Conversa não encontrada.');return {id:threadId,subject:header(m,'Subject'),sender:header(m,'From'),recipient:header(m,'To'),rfcMessageId:header(m,'Message-ID'),references:header(m,'References')};
 }
 async function archive(threadId){await api('threads/'+encodeURIComponent(threadId)+'/modify','POST',{removeLabelIds:['INBOX']});emails=emails.filter(e=>e.id!==threadId);emit();}
 async function reply(email,to,text,files=[]){
  const recipient=address(to);if(recipient!==to.trim()||/[\r\n]/.test(to))throw new Error('Informe um endereço de destinatário válido.');
  if(!text.trim())throw new Error('Escreva a resposta.');
  if(files.reduce((sum,f)=>sum+f.size,0)>10*1024*1024)throw new Error('Os anexos devem somar até 10 MB.');
  const line='\r\n',boundary='flow-'+crypto.randomUUID(),subject=/^re:/i.test(email.subject)?email.subject:'Re: '+email.subject;
  const safe=value=>String(value||'').replace(/[\r\n]/g,' ');
  const encoded=value=>'=?UTF-8?B?'+base64(new TextEncoder().encode(value))+'?=';
  const parts=['To: '+recipient,'Subject: '+encoded(subject),'MIME-Version: 1.0'];
  if(email.rfcMessageId){parts.push('In-Reply-To: '+safe(email.rfcMessageId));parts.push('References: '+safe((email.references||'')+' '+email.rfcMessageId));}
  parts.push('Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(new TextEncoder().encode(text)).match(/.{1,76}/g).join(line));
  for(const file of files){const name=encodeURIComponent(file.name),bytes=new Uint8Array(await file.arrayBuffer());parts.push('--'+boundary,'Content-Type: application/octet-stream','Content-Disposition: attachment; filename*=UTF-8\'\''+name,'Content-Transfer-Encoding: base64','',base64(bytes).match(/.{1,76}/g)?.join(line)||'');}
  parts.push('--'+boundary+'--','');
  return api('messages/send','POST',{threadId:email.id,raw:base64(new TextEncoder().encode(parts.join(line))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')});
 }
 function reset(){generation++;analysisEpoch++;emails=[];nextPage='';loading=false;analyzing=false;completed=0;error='';analysisError='';analysisBlocked=false;owner='';verifiedHistory='';emit();}
 globalThis.FlowGmailReview={refresh,analyze,reset,bodyText,address,archive,replyContext,reply,info:()=>({emails:FlowCloud.gmailToken()&&owner===FlowCloud.info().user?.id?emails:[],nextPage,loading,analyzing,completed,error:error||analysisError})};
})();
