import asyncio,os
from playwright.async_api import async_playwright,expect
async def run():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await b.new_page();await page.route('**/api/auth-config',lambda r:r.fulfill(json={'configured':False}));await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'));await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy','true')
  await page.evaluate("()=>localStorage.setItem('flow.workspace.v1',JSON.stringify({version:1,projects:[{id:'area',name:'Área'}],initiatives:[{id:'p',areaId:'area',name:'Projeto',sections:{0:'Plano'},risks:[{title:'Risco'}]}],tasks:[{id:'t',title:'Tarefa',project:'area',initiativeId:'p',status:'todo',sessions:[{start:1000,end:61000}],subtasks:[]}],preferences:{}}))")
  await page.reload();await page.locator('[data-page=meus-projetos]').click();await page.locator('[data-action=delete-initiative]').click()
  await page.locator('[name=confirmName]').fill('Errado');await page.locator('#active-modal-form [type=submit]').click();assert await page.locator('#active-modal-form').count()==1
  await page.locator('[name=confirmName]').fill('Projeto');await page.locator('#active-modal-form [type=submit]').click()
  data=await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1')))");assert data['initiatives']==[] and data['tasks'][0]['initiativeId'] is None and data['tasks'][0]['sessions'][0]['end']==61000
  entry=data['projectTrash'][0];assert entry['expiresAt']-entry['deletedAt']==30*86400000 and entry['project']['sections']['0']=='Plano'
  await page.reload();await page.locator('[data-page=meus-projetos]').click();await page.locator('.project-trash summary').click();await page.locator('[data-action=restore-initiative]').click()
  data=await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1')))");assert data['initiatives'][0]['sections']['0']=='Plano' and data['tasks'][0]['initiativeId']=='p' and data['projectTrash']==[]
  await page.locator('[data-action=delete-initiative]').click();await page.locator('[name=confirmName]').fill('Projeto');await page.locator('#active-modal-form [type=submit]').click()
  await page.evaluate("()=>{window.dispatchEvent(new Event('flow:persist-flush'));let d=JSON.parse(localStorage.getItem('flow.workspace.v1'));d.projectTrash[0].expiresAt=Date.now()-1;localStorage.setItem('flow.workspace.v1',JSON.stringify(d))}")
  await page.reload();await page.locator('[data-page=meus-projetos]').click();assert await page.locator('[data-action=restore-initiative]').count()==0
  assert await page.evaluate("(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1'))).projectTrash.length")==0
  print('PASS Named confirmation, 30-day trash, reopen/restore with task history, expired cache cleanup');await b.close()
asyncio.run(run())
