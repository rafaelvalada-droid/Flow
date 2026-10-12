import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000})
  state={'message':'abc123456789','analyses':0,'archived':0,'sent':None}
  async def route(req):
   url=req.request.url
   if 'cloud.js' in url:
    await req.fulfill(content_type='text/javascript',body='''window.FlowCloud={initialize:async()=>({mode:'cloud',key:'test-workspace',data:{version:1,areaCatalogVersion:5,projects:[{id:'oferta',name:'Oferta de turmas',color:'#507ee9'}],tasks:[],preferences:{}}}),info:()=>({mode:'cloud',user:{id:'test-owner',email:'user@ulbra.br'},status:'saved'}),queue:()=>{},flush:async()=>{if(window.failCloud)throw new Error('Falha de teste na nuvem')},calendarToken:()=>null,gmailToken:()=> 'google-token',analyzeGmail:async body=>{const r=await fetch('/api/gmail-review',{method:'POST',body:JSON.stringify(body)});return r.json()},disconnectGmail:()=>{},signIn:async()=>{}};''')
   elif 'gmail.googleapis.com' in url:
    if '/modify' in url:
     state['archived']+=1;data={'id':'abcdef1234567890'}
    elif '/messages/send' in url:
     state['sent']=json.loads(req.request.post_data);data={'id':'sent'}
    elif '/profile' in url:data={'emailAddress':'user@ulbra.br'}
    elif '/threads?' in url:data={'threads':[{'id':'abcdef1234567890'}]}
    else:data={'messages':[{'id':state['message'],'internalDate':'1791720000000','snippet':'Revisar turmas','payload':{'mimeType':'text/plain','headers':[{'name':'Subject','value':'Turmas PoA'},{'name':'From','value':'coord@ulbra.br'},{'name':'Message-ID','value':'<original@example.test>'}],'body':{'data':'UmV2aXNhciB0dXJtYXM='}}}]}
    await req.fulfill(json=data)
   elif '/api/gmail-review' in url:
    state['analyses']+=1
    await req.fulfill(json={'summary':'Solicita revisar turmas.','title':'Revisar turmas PoA','areaId':'oferta','dueDate':'2026-10-20','dateEvidence':'','needsReview':False,'alert':''})
   else:await req.continue_()
  await context.route('**/*',route)
  page=await context.new_page();await page.goto('http://127.0.0.1:3000')
  await expect(page.locator('.page-head h1')).to_have_text('Entrada')
  assert await page.locator('[data-page="gmail"]').count()==0
  await page.locator('#screen [data-action="new-task"]').click()
  await page.locator('#active-modal-form [name="title"]').fill('Entrada manual')
  await page.locator('#active-modal-form [type="submit"]').click()
  await expect(page.locator('.gmail-review-card').filter(has_text='Entrada manual')).to_be_visible()
  await page.locator('[data-action="gmail-refresh"]').click()
  await expect(page.locator('form[data-email-review]')).to_have_count(1)
  await page.locator('[data-action="gmail-analyze"]').click()
  await expect(page.locator('.gmail-summary').filter(has_text='Solicita revisar')).to_be_visible()
  await page.locator('[data-action="gmail-analyze"]').click()
  assert state['analyses']==1
  await page.locator('[data-sender-color]').fill('#9270d4')
  await page.locator('[data-sender-color]').dispatch_event('change')
  assert await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).gmailSenderColors['coord@ulbra.br']")=='#9270d4'
  await page.locator('[data-reply-email]').click()
  await page.locator('#active-modal-form [name="message"]').fill('Resposta com anexo')
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
  assert state['archived']==1
  await page.set_viewport_size({'width':390,'height':844})
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('PASS Unified inbox accepts manual input, reads Gmail, caches analysis, confirms tasks and updates replies without duplicates; mobile fits')
  await browser.close()
asyncio.run(run())
