import asyncio,os
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright
async def run(profile):
 async with async_playwright() as p:
  context=await p.chromium.launch_persistent_context(profile,executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await context.new_page()
  await page.goto(os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000'))
  await page.evaluate('navigator.serviceWorker.ready')
  client=await context.new_cdp_session(page)
  manifest=await client.send('Page.getAppManifest')
  assert not manifest['errors'],manifest['errors']
  result=await client.send('Page.getInstallabilityErrors')
  assert not result['installabilityErrors'],result
  print('PASS Chrome reports no installability errors',flush=True)
  await page.evaluate('navigator.serviceWorker.ready.then(()=>navigator.serviceWorker.controller||new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true})))')
  await context.set_offline(True)
  await page.reload()
  assert await page.get_by_text('Conecte-se à internet',exact=False).count()==1
  print('PASS Offline app navigation shows the public connection page',flush=True)
  await context.close()
with TemporaryDirectory(prefix='flow-pwa-') as profile:asyncio.run(run(profile))
