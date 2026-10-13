"""Delayed service simulation: progressive classification, metadata-first incremental reads and stable input nodes."""
import asyncio,json,os,time
from playwright.async_api import async_playwright
# Espera por polling com page.evaluate: wait_for_function avalia texto e a CSP (script-src 'self') bloqueia eval.
async def until(page,expression,timeout=30):
 deadline=time.perf_counter()+timeout
 while not await page.evaluate(expression):
  assert time.perf_counter()<deadline,'Timeout: '+expression
  await asyncio.sleep(.05)
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':390,'height':844})
  state={'history':'100','gmail':0,'metadata':0,'full':0,'analyses':0,'first_metadata_count':None,'changed':False,'reviews':None}
  async def route(r):
   url=r.request.url
   if url.endswith('/cloud.js'):
    reviews=json.dumps(state['reviews'] or {})
    await r.fulfill(content_type='text/javascript',body="""window.FlowCloud={initialize:async()=>({mode:'cloud',key:'performance-test',data:{version:1,areaCatalogVersion:5,projects:[{id:'oferta',name:'Oferta de turmas',color:'#507ee9'}],tasks:[],preferences:{},gmailReviews:"""+reviews+"""}}),info:()=>({mode:'cloud',user:{id:'owner',email:'user@ulbra.br'},status:'saved'}),queue:()=>{},flush:async()=>{},calendarToken:()=>null,gmailToken:()=> 'token',analyzeGmail:async body=>{const r=await fetch('/api/gmail-review',{method:'POST',body:JSON.stringify(body)});return r.json()}};""")
   elif 'gmail.googleapis.com' in url:
    state['gmail']+=1;await asyncio.sleep(.05)
    if '/profile' in url:data={'emailAddress':'user@ulbra.br','historyId':state['history']}
    elif '/history?' in url:data={'history':[{'messagesAdded':[{'message':{'threadId':'thread0'}}]}]}
    elif '/threads?' in url:data={'threads':[{'id':'thread'+str(i)} for i in range(25)]}
    else:
     state['full' if 'format=full' in url else 'metadata']+=1;thread=url.split('/threads/')[1].split('?')[0]
     data={'messages':[{'id':('new' if state['changed'] and thread=='thread0' else 'message')+thread,'internalDate':'1791720000000','snippet':'Solicita revisão','payload':{'mimeType':'text/plain','headers':[{'name':'Subject','value':'Turmas '+thread},{'name':'From','value':'coord@ulbra.br'}],'body':{'data':'UmV2aXNhciB0dXJtYXM='}}}]}
    await r.fulfill(json=data)
   elif '/api/gmail-review' in url:
    state['analyses']+=1
    if state['first_metadata_count'] is None:state['first_metadata_count']=state['metadata']
    await asyncio.sleep(.04)
    await r.fulfill(json={'summary':'Solicita revisão.','title':'Revisar turmas','areaId':'oferta','dueDate':'','dateEvidence':'','needsReview':False,'alert':''})
   else:await r.continue_()
  await context.route('**/*',route)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script("window.screenReplacements=0;new MutationObserver(ms=>{for(const m of ms)if(m.target.id==='screen'&&m.removedNodes.length&&!Array.from(m.removedNodes).some(n=>n.nodeType===1&&(n.matches('#google-login,#login-message')||n.querySelector('#google-login,#login-message'))))screenReplacements++}).observe(document,{childList:true,subtree:true});")
  started=time.perf_counter();await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'))
  await until(page,"window.FlowGmailReview?.info().emails.length===25&&!FlowGmailReview.info().loading&&!FlowGmailReview.info().analyzing&&document.querySelectorAll('.gemini-status.classified').length===25")
  assert state['first_metadata_count']<25,'Classification must start before the full inbox finishes loading'
  assert state['analyses']==25 and state['metadata']==25 and state['full']==25,'Each conversation: one metadata read and one body download for its analysis'
  assert await page.evaluate('screenReplacements')==0
  title=page.locator('form[data-email-review="thread1"] [name="title"]');await title.fill('Meu título em edição')
  await title.evaluate('(node)=>{window.retainedInput=node;node.setSelectionRange(3,3)}')
  state['gmail']=state['full']=state['metadata']=0;await page.evaluate('FlowGmailReview.refresh()');await page.wait_for_timeout(50)
  assert state['gmail']==1 and state['full']==0 and state['metadata']==0
  assert await title.evaluate('(node)=>node===retainedInput&&node===document.activeElement&&node.selectionStart===3')
  state['history']='101';state['changed']=True;state['gmail']=state['full']=state['metadata']=0
  await page.evaluate('FlowGmailReview.refresh()')
  await until(page,"!FlowGmailReview.info().loading&&!FlowGmailReview.info().analyzing&&FlowGmailReview.info().emails.find(e=>e.id==='thread0').messageId==='newthread0'")
  await page.wait_for_timeout(50)
  assert state['metadata']==1 and state['full']==1 and state['analyses']==26,'Only the changed conversation needs a new download and analysis'
  assert await title.input_value()=='Meu título em edição'
  assert await title.evaluate('(node)=>node===retainedInput&&node===document.activeElement&&node.selectionStart===3')
  assert await page.evaluate('screenReplacements')==0
  assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors
  # Reabrir o app com as revisões salvas: só metadados, nenhum corpo e nenhuma análise.
  state['reviews']=await page.evaluate("JSON.parse(localStorage.getItem('performance-test')).gmailReviews")
  assert len(state['reviews'])==25 and all(isinstance(r.get('at'),(int,float)) for r in state['reviews'].values())
  state['gmail']=state['full']=state['metadata']=state['analyses']=0
  reopened=await context.new_page();reopened.on('pageerror',lambda e:errors.append(str(e)))
  await reopened.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'))
  await until(reopened,"window.FlowGmailReview?.info().emails.length===25&&!FlowGmailReview.info().loading&&!FlowGmailReview.info().analyzing")
  await reopened.wait_for_timeout(100)
  assert state['metadata']==25 and state['full']==0 and state['analyses']==0,'A reopened app with cached reviews downloads no conversation body'
  assert not errors,errors
  print('PASS 25 delayed emails classify progressively; unchanged refresh makes 1 call; changed refresh downloads 1 conversation; reopening with cached reviews reads metadata only; input nodes, text and caret survive on mobile')
  await browser.close()
asyncio.run(run())
