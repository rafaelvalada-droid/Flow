import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000})
  state={'message':'abc123456789','late':None,'analyses':0,'drafts':0,'archived':0,'archive_ids':None,'sent':None,'formats':[]}
  async def route(req):
   url=req.request.url
   if 'cloud.js' in url:
    await req.fulfill(content_type='text/javascript',body='''window.FlowCloud={initialize:async()=>({mode:'cloud',key:'test-workspace',data:{version:1,areaCatalogVersion:5,projects:[{id:'oferta',name:'Oferta de turmas',color:'#507ee9'}],tasks:[],preferences:{}}}),info:()=>({mode:'cloud',user:{id:'test-owner',email:'user@ulbra.br'},status:'saved'}),queue:()=>{},flush:async()=>{if(window.failCloud)throw new Error('Falha de teste na nuvem')},calendarToken:()=>null,gmailToken:()=> 'google-token',analyzeGmail:async body=>{const r=await fetch('/api/gmail-review',{method:'POST',body:JSON.stringify(body)});return r.json()},disconnectGmail:()=>{},signIn:async()=>{}};''')
   elif 'gmail.googleapis.com' in url:
    if '/modify' in url or '/batchModify' in url:
     state['archived']+=1;state['archive_ids']=json.loads(req.request.post_data).get('ids');data={}
    elif '/messages/send' in url:
     state['sent']=json.loads(req.request.post_data);data={'id':'sent'}
    elif '/profile' in url:data={'emailAddress':'user@ulbra.br'}
    elif '/threads?' in url:data={'threads':[{'id':'abcdef1234567890'}]}
    else:
     fmt=url.split('format=')[1].split('&')[0] if 'format=' in url else '';state['formats'].append(fmt)
     ids=[state['message']]+([state['late']] if state['late'] and fmt=='minimal' else [])
     data={'messages':[{'id':i,'labelIds':['INBOX'],'internalDate':'1791720000000','snippet':'Revisar turmas','payload':{'mimeType':'text/plain','headers':[{'name':'Subject','value':'Turmas PoA'},{'name':'From','value':'coord@ulbra.br'},{'name':'Message-ID','value':'<original@example.test>'}],'body':{'data':'UmV2aXNhciB0dXJtYXM='}}} for i in ids]}
    await req.fulfill(json=data)
   elif '/api/gmail-review' in url:
    body=json.loads(req.request.post_data)
    if body.get('mode')=='reply':
     state['drafts']+=1;await req.fulfill(json={'reply':'Resposta revisada pelo Gemini.'});return
    state['analyses']+=1
    await req.fulfill(json={'summary':'Solicita revisar turmas.','title':'Revisar turmas PoA','areaId':'oferta','dueDate':'2026-10-20','dateEvidence':'','needsReview':False,'alert':''})
   else:await req.continue_()
  await context.route('**/*',route)
  page=await context.new_page();await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'))
  await expect(page.locator('.page-head h1')).to_have_text('Entrada')
  assert await page.locator('[data-page="gmail"]').count()==0
  await page.locator('#screen [data-action="new-task"]').click()
  await page.locator('#active-modal-form [name="title"]').fill('Entrada manual')
  await page.locator('#active-modal-form [type="submit"]').click()
  await expect(page.locator('.gmail-review-card').filter(has_text='Entrada manual')).to_be_visible()
  await page.locator('[data-action="gmail-refresh"]').click()
  await expect(page.locator('form[data-email-review]')).to_have_count(1)
  await expect(page.locator('[data-action="gmail-refresh"]')).to_be_enabled()
  assert state['formats'][:1]==['metadata'] and state['formats'].count('full')<=1,'The inbox list reads metadata; only the analysis downloads the body'
  await page.locator('[data-action="gmail-analyze"]').click()
  await expect(page.locator('.gmail-summary').filter(has_text='Solicita revisar')).to_be_visible()
  await page.locator('[data-action="gmail-analyze"]').click()
  assert state['analyses']==1 and state['formats'].count('full')==1,'The body is downloaded once, only for analysis'
  # Windows-1252: aspas tipográficas e euro (0x93, 0x94, 0x80) decodificados pelo Chromium.
  assert await page.evaluate("FlowGmailReview.bodyText({mimeType:'text/plain',headers:[{name:'Content-Type',value:'text/plain; charset=windows-1252'}],body:{data:'k0GUIIBjb27n428'}})")=='\u201cA\u201d \u20accon\u00e7\u00e3o'
  await expect(page.get_by_text('Classificado pelo Gemini',exact=True)).to_be_visible()
  title=page.locator('form[data-email-review] [name="title"]')
  await title.fill('Título ajustado')
  await title.evaluate('(input)=>input.setSelectionRange(3,3)')
  before=await title.evaluate('(input)=>input.getBoundingClientRect().top')
  await page.evaluate('FlowGmailReview.refresh()')
  assert await page.evaluate('document.activeElement.name')=='title'
  assert await title.evaluate('(input)=>input.selectionStart')==3
  assert abs(await title.evaluate('(input)=>input.getBoundingClientRect().top')-before)<2

  await page.locator('[data-sender-color]').fill('#9270d4')
  await page.locator('[data-sender-color]').dispatch_event('change')
  assert await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).gmailSenderColors['coord@ulbra.br']")=='#9270d4'
  await page.locator('[data-reply-email]').click()
  await page.evaluate('''() => {window.SpeechRecognition=class{start(){this.onresult({results:[{isFinal:true,0:{transcript:'Minha ideia falada'}}]})}stop(){this.onend()}abort(){this.onend()}};}''')
  await page.locator('#reply-dictate').click()
  await expect(page.locator('#active-modal-form [name="idea"]')).to_have_value('Minha ideia falada')
  await page.locator('#reply-dictate').click()
  await page.locator('#reply-rewrite').click()
  await expect(page.locator('#active-modal-form [name="message"]')).to_have_value('Resposta revisada pelo Gemini.')
  assert state['sent'] is None and state['drafts']==1

  await page.locator('#active-modal-form [name="attachments"]').set_input_files({'name':'teste.txt','mimeType':'text/plain','buffer':b'attachment'})
  await page.locator('#active-modal-form [type="submit"]').click()
  await expect(page.locator('#modal-backdrop')).to_have_class('modal-backdrop hidden')
  import base64
  raw=base64.urlsafe_b64decode(state['sent']['raw']+'='*((4-len(state['sent']['raw'])%4)%4)).decode()
  assert 'filename*=UTF-8' in raw and 'In-Reply-To: <original@example.test>' in raw
  await page.evaluate('window.failCloud=true')
  await page.locator('form[data-email-review] [type="submit"]').click()
  await expect(page.get_by_text('A nuvem não confirmou o salvamento.',exact=False)).to_be_visible()
  assert state['archived']==0
  await page.evaluate('window.failCloud=false')
  await page.locator('form[data-email-review] [name="archive"]').uncheck()
  await page.locator('form[data-email-review] [type="submit"]').click()
  assert await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).tasks.length")==2
  state['message']='new123456789'
  await page.locator('[data-action="gmail-refresh"]').click()
  await expect(page.get_by_text('Nova resposta · demanda já vinculada')).to_be_visible()
  await page.locator('form[data-email-review] [type="submit"]').click()
  assert await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).tasks.length")==2
  await expect(page.get_by_text('Demanda salva e e-mail arquivado.')).to_be_visible()
  assert state['archived']==1 and state['archive_ids']==['new123456789']
  # Uma resposta chega entre a revisão e o arquivamento: nada é arquivado e o aviso explica.
  state['message']='third123456789';await page.locator('[data-action="gmail-refresh"]').click()
  await expect(page.get_by_text('Nova resposta · demanda já vinculada')).to_be_visible()
  state['late']='late123456789'
  await page.locator('form[data-email-review] [type="submit"]').click()
  await expect(page.get_by_text('Chegou uma nova mensagem nesta conversa',exact=False)).to_be_visible()
  assert state['archived']==1
  assert await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).tasks.length")==2
  await page.set_viewport_size({'width':390,'height':844})
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('PASS Unified inbox accepts manual input, reads Gmail metadata first, caches analysis, decodes Windows-1252, confirms tasks, updates replies without duplicates and refuses to archive a newer reply; mobile fits')
  await browser.close()
asyncio.run(run())
