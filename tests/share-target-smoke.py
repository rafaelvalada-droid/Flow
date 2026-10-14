import asyncio,os
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright,expect
# Grava o que o app ainda agrupa em memória (mesmo evento da extensão) e lê o workspace.
STORED="(window.dispatchEvent(new Event('flow:persist-flush')),JSON.parse(localStorage.getItem('flow.workspace.v1')))"
async def run(profile):
 async with async_playwright() as p:
  context=await p.chromium.launch_persistent_context(profile,executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await context.new_page();base=os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000')
  await page.goto(base)
  await page.evaluate('navigator.serviceWorker.ready.then(()=>navigator.serviceWorker.controller||new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true})))')
  await page.evaluate('''() => {const form=document.createElement('form');form.method='POST';form.enctype='multipart/form-data';form.action='/share-target';for(const [name,value] of Object.entries({title:'Mensagem WhatsApp',text:'Confira as turmas para a próxima semana.',url:'https://example.com/documento'})){const input=document.createElement('input');input.name=name;input.value=value;form.append(input)}document.body.append(form);form.submit();}''')
  await expect(page.locator('#active-modal-form [name="title"]')).to_have_value('Mensagem WhatsApp')
  await expect(page.locator('#active-modal-form [name="description"]')).to_contain_text('Confira as turmas')
  assert await page.evaluate(STORED+".tasks.length")==4
  await page.locator('[data-action="close-modal"]').click()
  await expect(page.get_by_text('Texto compartilhado recebido')).to_be_visible()
  await page.reload()
  await expect(page.locator('#active-modal-form')).to_be_visible()
  await page.locator('#active-modal-form [name="project"]').select_option('oferta')
  await page.locator('#active-modal-form [name="dueDate"]').fill('2026-10-20')
  await page.locator('#active-modal-form [type="submit"]').click()
  await page.locator('#board-date-filter').select_option('all')
  await expect(page.locator('.pipeline-task').filter(has_text='Mensagem WhatsApp')).to_be_visible()
  db=await page.evaluate(STORED)
  assert len(db['tasks'])==5 and db['tasks'][0]['source']=='share'
  assert db['tasks'][0]['sharedUrl']=='https://example.com/documento'
  await page.reload()
  await expect(page.locator('#active-modal-form')).to_have_count(0)
  print('PASS Shared POST stays on device, requires confirmation, survives reload and saves one classified demand')
  await context.close()
with TemporaryDirectory(prefix='flow-share-') as profile:asyncio.run(run(profile))
