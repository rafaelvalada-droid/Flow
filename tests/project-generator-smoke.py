import asyncio,os
from playwright.async_api import async_playwright,expect
async def run():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/api/auth-config',lambda r:r.fulfill(json={'configured':False}));await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'));await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy','true')
  await page.evaluate("()=>{localStorage.setItem('flow.workspace.v1',JSON.stringify({version:1,projects:[{id:'area',name:'Area'}],initiatives:[{id:'old',name:'Projeto existente',areaId:'area'}],tasks:[],preferences:{}}))}")
  await page.reload();await page.locator('.project-nav-menu summary').click()
  labels=await page.locator('#project-template-menu button').all_text_contents();assert 'Meus Projetos' not in labels
  assert await page.locator('#sidebar-nav > button[data-page=meus-projetos]').count()==1
  await page.locator('[data-project-model=pdca]').click();assert await page.locator('#project-editor-form').count()==1 and await page.locator('#active-modal-form').count()==0
  assert await page.locator('[data-project-improve]').count()>=6
  assert await page.locator('.project-step-card .field-help').count()==4
  await page.locator('#project-editor-form [name=name]').fill('PDCA teste');await page.locator('#project-editor-form [name=areaId]').select_option('area');await page.locator('[name=section-0]').fill('Diminuir atrasos')
  await page.locator('[name=model]').select_option('fivew');assert await page.locator('.project-step-card').count()==7
  await page.locator('[name=model]').select_option('pdca');assert await page.locator('[name=section-0]').input_value()=='Diminuir atrasos'
  await page.evaluate("()=>{FlowCloud.analyzeGmail=async body=>({reply:body.mode==='project-title'?'Melhoria dos prazos':'Reduzir atrasos no processo.'})}")
  await page.locator('[data-project-improve=name]').click();await expect(page.locator('#project-editor-form [name=name]')).to_have_value('Melhoria dos prazos')
  await page.locator('textarea[name=description]').fill('Melhorar os prazos');await page.locator('[data-project-improve=description]').click();await expect(page.locator('textarea[name=description]')).to_have_value('Reduzir atrasos no processo.')
  await page.locator('[data-project-improve=section-0]').click();await expect(page.locator('[name=section-0]')).to_have_value('Reduzir atrasos no processo.')
  await page.locator('#project-editor-form [type=submit]').click();assert await page.locator('#project-editor-form').count()==1
  data=await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1'))).initiatives");assert len(data)==2 and data[1]['sections']['0']=='Reduzir atrasos no processo.'
  await page.locator('[data-action=project-editor-back]').click();assert 'Projeto existente' in await page.locator('#screen').inner_text()
  await page.locator('[data-action=edit-model-project]').last.click();assert await page.locator('[name=section-0]').input_value()=='Reduzir atrasos no processo.'
  await page.set_viewport_size({'width':390,'height':844});assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors;print('PASS Full page, explained stages, drafts across model changes, Gemini on title/description/stages, save/edit and mobile layout');await b.close()
asyncio.run(run())

async def tracking():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await b.new_page(timezone_id='America/Sao_Paulo');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/api/auth-config',lambda r:r.fulfill(json={'configured':False}));await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'));await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy','true')
  await page.evaluate("()=>{let d=new Date(),date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');localStorage.setItem('flow.workspace.v1',JSON.stringify({version:1,projects:[{id:'area',name:'Area'}],initiatives:[{id:'old',name:'Projeto da área',areaId:'area'}],tasks:[{id:'task',title:'Conferir dados',project:'area',dueDate:date,status:'todo',sessions:[{start:1000,end:61000}],subtasks:[]}],preferences:{}}))}")
  await page.reload();await page.locator('.project-nav-menu summary').click()
  assert 'Avaliação Gemini' in await page.locator('#project-template-menu button').first.inner_text()
  await page.locator('[data-page=project-assessment]').click();await page.locator('[name=problem]').fill('Reduzir atrasos na oferta de turmas');await page.locator('[name=people]').fill('Coordenação');await page.locator('[name=areaId]').select_option('area')
  await page.evaluate("""()=>{FlowCloud.analyzeGmail=async body=>{
   if(body.mode==='project-assess')return {projectAssessment:{summary:'Melhoria de um processo recorrente',recommendations:[{modelId:'pdca',reason:'Permite medir e ajustar',firstSteps:'Medir os atrasos'}]}};
   if(body.mode==='project-plan'){const idea=JSON.parse(body.text);if(idea.people!=='Coordenação')throw Error('People were omitted');return {projectPlan:{name:'Melhoria da oferta',description:'Reduzir atrasos com acompanhamento',sections:body.areas.map(f=>({id:f.id,text:'Planejar a etapa '+f.name})),milestones:[{name:'Diagnóstico',dueDate:''},{name:'Implantação',dueDate:''}],risks:[{title:'Falta de informação',mitigation:'Levantar os dados'}]}};}
   return {reply:'Texto revisado'};
  }}""")
  await page.locator('#project-assessment-form [type=submit]').click();await page.locator('[data-use-recommendation=pdca]').click();await page.wait_for_selector('.project-suggestion')
  count=await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1'))).initiatives.length");assert count==1,'Generation cannot silently save projects'
  await page.locator('[data-action=project-apply-plan]').click();assert await page.locator('[name=section-0]').input_value()!=''
  await page.locator('[data-action=project-add-row][data-collection=indicators]').click()
  await page.locator('[name^="indicators:"][name$=":name"]').fill('Atrasos')
  await page.locator('[name^="indicators:"][name$=":baseline"]').fill('10');await page.locator('[name^="indicators:"][name$=":target"]').fill('2');await page.locator('[name^="indicators:"][name$=":current"]').fill('6')
  await page.locator('[name=note]').fill('Início da análise com a equipe');await page.locator('#project-editor-form [type=submit]').click()
  assert await page.locator('progress').get_attribute('value')=='50'
  await page.locator('#project-link-task').select_option('task');await page.locator('[data-action=project-link-task]').click()
  await page.locator('#project-tasks [data-complete-task=task]').check();assert '100%' in await page.locator('.project-kpis').inner_text()
  # Desmarcar reabre a tarefa e o avanço volta; marcar de novo conclui.
  await page.locator('#project-tasks [data-complete-task=task]').click();await expect(page.locator('#project-tasks [data-complete-task=task]')).not_to_be_checked();assert '100%' not in await page.locator('.project-kpis').inner_text()
  await page.locator('#project-tasks [data-complete-task=task]').click();await expect(page.locator('#project-tasks [data-complete-task=task]')).to_be_checked();assert '100%' in await page.locator('.project-kpis').inner_text()
  await page.locator('[name^="milestones:"][name$=":done"]').first.check();await page.locator('#project-editor-form [type=submit]').click()
  data=await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1')))");project=data['initiatives'][-1]
  assert project['notes'][0]['text']=='Início da análise com a equipe' and len(project['history'])==2
  assert project['milestones'][0]['done'] and project['indicators'][0]['current']=='6'
  assert data['tasks'][0]['initiativeId']==project['id'] and data['tasks'][0]['sessions'][0]['end']==61000
  async with page.expect_download() as downloading:await page.locator('[data-action=project-export]').click()
  download=await downloading.value;assert download.suggested_filename.endswith('.html')
  await page.reload();await page.locator('.project-nav-menu summary').click();await page.locator('[data-page=meus-projetos]').click();assert 'Projeto da área' in await page.locator('#screen').inner_text()
  await page.locator('[data-action=edit-model-project]').last.click();assert await page.locator('[name^="milestones:"][name$=":done"]').first.is_checked()
  assert await page.locator('[name=owner]').input_value()=='Coordenação'
  # A failed generation preserves the existing plan and unlocks the editor.
  await page.evaluate("()=>{FlowCloud.analyzeGmail=async()=>{throw Error('Cota simulada')}}");before=await page.locator('[name=section-0]').input_value();await page.locator('[data-action=project-generate]').click();await expect(page.locator('#project-model-status')).to_contain_text('Cota simulada')
  assert await page.locator('[name=section-0]').input_value()==before and await page.locator('#project-editor-form [type=submit]').is_enabled()
  await page.set_viewport_size({'width':390,'height':844});assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors;print('PASS Assessment to reviewed plan; indicators, task linkage/completion, milestones, history, export, reopening and failure recovery');await b.close()
asyncio.run(tracking())

async def mobile_menu():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await browser.new_page(viewport={'width':390,'height':844})
  await page.route('**/api/auth-config',lambda r:r.fulfill(json={'configured':False}));await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'))
  await page.locator('.project-nav-menu summary').scroll_into_view_if_needed();await page.locator('.project-nav-menu summary').click()
  assert (await page.locator('.sidebar').bounding_box())['height']<180,'Opening the menu must not stretch mobile navigation'
  await page.locator('[data-project-model=pdca]').click();assert not await page.locator('.project-nav-menu').evaluate('(node)=>node.open')
  assert await page.locator('#project-editor-form').count()==1
  assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  print('PASS Phone menu stays compact, closes on selection and opens the full project page');await browser.close()
asyncio.run(mobile_menu())
