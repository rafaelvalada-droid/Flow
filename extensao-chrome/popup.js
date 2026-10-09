// Captura mínima: não lê o corpo do e-mail, nem pede acesso à API Gmail.
const statusEl=document.getElementById('status');
const subjectEl=document.getElementById('subject');
const senderEl=document.getElementById('sender');
const flowUrlEl=document.getElementById('flow-url');
const captureBtn=document.getElementById('capture');
let captured=null;
const update=msg=>{statusEl.textContent=msg};

(async()=>{
  const saved=await chrome.storage.local.get('flowUrl');
  flowUrlEl.value=saved.flowUrl||'http://localhost:3000';
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url?.startsWith('https://mail.google.com/')){
    subjectEl.textContent='Abra uma conversa no Gmail';update('Esta extensão só captura conversas do Gmail.');return;
  }
  try{
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
      // Os seletores podem mudar em atualizações do Gmail.
      const subject=document.querySelector('h2.hP')?.textContent?.trim()||document.title.replace(/\s*-\s*Gmail\s*$/i,'').trim();
      const sender=document.querySelector('.gD[email]')?.getAttribute('email')||document.querySelector('.gD')?.textContent?.trim()||'';
      return {subject,sender};
    }});
    const data=result?.[0]?.result||{};
    captured={gmailUrl:tab.url,gmailSubject:String(data.subject||'Conversa sem assunto'),gmailSender:String(data.sender||'')};
    subjectEl.textContent=captured.gmailSubject;
    senderEl.textContent=captured.gmailSender||'Remetente não identificado';
    if(!/#[^/]*(?:\/|[a-zA-Z0-9_-]{8,})/.test(tab.url))update('Confira se a conversa está aberta; o endereço pode apontar só para a caixa de entrada.');
    captureBtn.disabled=false;
  }catch{
    subjectEl.textContent='Não foi possível ler a conversa';update('Atualize o Gmail, abra a mensagem e tente novamente.');
  }
})();

captureBtn.addEventListener('click',async()=>{
  if(!captured)return;
  let target;
  try{target=new URL(flowUrlEl.value.trim())}catch{update('Informe um endereço válido do Flow.');return}
  const isLocal=['localhost','127.0.0.1'].includes(target.hostname);
  if(target.protocol!=='https:' && !(isLocal&&target.protocol==='http:')){update('Use HTTPS, exceto para localhost.');return}
  target.hash='capture='+encodeURIComponent(JSON.stringify(captured));
  await chrome.storage.local.set({flowUrl:`${target.origin}${target.pathname}`});
  await chrome.tabs.create({url:target.href});
  window.close();
});
