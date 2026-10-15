"""Browser checks of the opening overlay: display rules, focus, dismissal, mobile layout and reduced motion."""
import asyncio
import re
import os
from playwright.async_api import async_playwright, expect

BASE=os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000')
# Simula um navegador comum (sem automação) para validar as regras de exibição.
HUMAN="Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>false});"
# Registra se a classe da abertura chegou a ser aplicada, mesmo que por um instante.
CSP="window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));"
WATCH="""window.__openingSeen=false;new MutationObserver(()=>{if(document.documentElement.classList.contains('flow-opening'))window.__openingSeen=true}).observe(document,{attributes:true,subtree:true,attributeFilter:['class']});"""

async def run():
    checks=0
    def passed(message):
        nonlocal checks
        checks+=1
        print('PASS '+message,flush=True)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])

        async def open_page(width=1440,height=900,motion='no-preference',scripts=()):
            context=await browser.new_context(viewport={'width':width,'height':height},reduced_motion=motion)
            page=await context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
            for script in scripts:await page.add_init_script(script)
            return context,page,errors

        context,page,errors=await open_page(scripts=[WATCH])
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        assert await page.locator('#flow-opening').count()==0
        assert not await page.evaluate('window.__openingSeen')
        assert await page.evaluate('navigator.webdriver')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        assert not errors,errors
        await context.close()
        passed('Automated browsers never see the opening and use the app immediately')

        context,page,errors=await open_page(scripts=[CSP])
        await page.goto(BASE+'/?abertura=1')
        overlay=page.locator('#flow-opening')
        await expect(overlay).to_be_visible()
        assert await page.locator('[data-fo-beat]').count()==3
        await expect(page.locator('#fo-title')).to_have_text('Entre em Fluxo.')
        await expect(page.locator('[data-fo-beat="2"] h2')).to_be_visible()
        await expect(page.locator('[data-fo-beat="3"] h2')).to_be_visible()
        await expect(page.locator('.fo-stages li')).to_have_text(['01Classificar','02Preparar','03Executar','04Aguardar','05Entregar'])
        assert await page.locator('.fo-dots circle').count()==60
        assert await page.evaluate('document.activeElement.matches("[data-fo-enter]")')
        assert await page.evaluate('document.querySelector(".app-shell").inert')
        for _ in range(3):
            await page.keyboard.press('Tab')
            assert await page.evaluate('document.querySelector("#flow-opening").contains(document.activeElement)')
        await page.keyboard.press('Shift+Tab')
        assert await page.evaluate('document.querySelector("#flow-opening").contains(document.activeElement)')
        names=await page.evaluate('[".fo-dots",".fo-head",".fo-card",".fo-streams"].map(s=>getComputedStyle(document.querySelector(s)).animationName)')
        assert all(name!='none' for name in names),names
        passed('?abertura=1 forces the overlay with three beats, focused CTA, inert app and trapped focus')

        await page.locator('[data-fo-enter]').focus()
        await page.locator('[data-fo-enter]').click()
        await expect(overlay).to_have_count(0)
        assert 'abertura' not in page.url
        assert not await page.evaluate('document.documentElement.classList.contains("flow-opening")')
        assert not await page.evaluate('document.querySelector(".app-shell").inert')
        assert await page.evaluate('document.querySelector(".app-shell").contains(document.activeElement)')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        assert not errors,errors
        assert await page.evaluate('window.__csp')==[]
        await context.close()
        passed('Entrar em Fluxo removes the overlay, cleans the URL and returns focus to an interactive app')

        # Clique antes de o app terminar de carregar: a abertura espera (indicador girando) e só então sai, sem mostrar o carregamento.
        context,page,errors=await open_page(scripts=[CSP])
        await page.goto(BASE+'/?abertura=1')
        await expect(page.locator('#flow-opening')).to_be_visible()
        await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy','true')
        await page.evaluate("document.querySelector('.app-shell').setAttribute('aria-busy','true')")
        await page.locator('[data-fo-enter]').click()
        await page.wait_for_timeout(900)
        await expect(page.locator('#flow-opening')).to_have_class(re.compile('is-waiting'))
        assert await page.evaluate('document.querySelector(".app-shell").inert')
        await page.evaluate("document.querySelector('.app-shell').removeAttribute('aria-busy')")
        await expect(page.locator('#flow-opening')).to_have_count(0)
        assert not await page.evaluate('document.querySelector(".app-shell").inert')
        # A saída anima só a própria abertura: o app não recebe transformação.
        assert await page.evaluate('getComputedStyle(document.querySelector(".app-shell")).transform')=='none'
        assert not errors,errors
        await context.close()
        passed('Clicking before the app finished loading waits on the opening, then leaves with a light fade that never transforms the app')

        for key in ['Enter','Escape']:
            context,page,errors=await open_page()
            await page.goto(BASE+'/?abertura=1&x=1#topo')
            await expect(page.locator('#flow-opening')).to_be_visible()
            await page.keyboard.press(key)
            await expect(page.locator('#flow-opening')).to_have_count(0)
            assert page.url.endswith('/?x=1#topo'),page.url
            assert await page.locator('.modal-backdrop:not(.hidden)').count()==0
            assert not errors,errors
            await context.close()
        passed('Enter and Escape dismiss the overlay and keep other URL parts')

        context,page,errors=await open_page(390,844)
        await page.goto(BASE+'/?abertura=1')
        await expect(page.locator('#flow-opening')).to_be_visible()
        await page.wait_for_timeout(1200)
        sizes=await page.evaluate('(()=>{const o=document.querySelector("#flow-opening");return [document.documentElement.scrollWidth,innerWidth,o.scrollWidth,o.clientWidth]})()')
        assert sizes[0]<=sizes[1] and sizes[2]<=sizes[3],sizes
        box=await page.locator('[data-fo-enter]').bounding_box()
        assert box and box['x']>=15 and box['x']+box['width']<=375 and box['y']+box['height']<=844,box
        await page.locator('#flow-opening').evaluate('o=>o.scrollTo(0,o.scrollHeight)')
        assert await page.locator('[data-fo-enter]').is_visible()
        await page.locator('[data-fo-enter]').click()
        await expect(page.locator('#flow-opening')).to_have_count(0)
        assert not errors,errors
        await context.close()
        passed('At 390 px the overlay has no horizontal overflow and the CTA stays reachable')

        context,page,errors=await open_page(motion='reduce')
        await page.goto(BASE+'/?abertura=1')
        await expect(page.locator('#flow-opening')).to_be_visible()
        styles=await page.evaluate('[".fo-dots",".fo-head",".fo-card",".fo-card-in",".fo-streams",".fo-progress",".fo h1",".fo-orbit"].map(s=>{const c=getComputedStyle(document.querySelector(s));return [s,c.animationName,c.animationDuration]})')
        assert all(name=='none' for _,name,_ in styles),styles
        assert await page.evaluate('getComputedStyle(document.querySelector(".fo-progress")).getPropertyValue("--fo-pct").trim()')=='72'
        await page.locator('[data-fo-enter]').click()
        await expect(page.locator('#flow-opening')).to_have_count(0)
        assert not errors,errors
        await context.close()
        passed('Reduced motion shows a static composition and dismisses without animation')

        context,page,errors=await open_page(scripts=[HUMAN,WATCH])
        await page.goto(BASE)
        await expect(page.locator('#flow-opening')).to_be_visible()
        assert await page.evaluate('window.__openingSeen')
        await page.locator('[data-fo-skip]').click()
        await expect(page.locator('#flow-opening')).to_have_count(0)
        await page.reload()
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        assert await page.locator('#flow-opening').count()==0 and not await page.evaluate('window.__openingSeen')
        await context.close()
        for path in ['/?shared=00000000-0000-4000-8000-000000000000','/?code=abc','/?error=access_denied','/#access_token=abc','/#capture=%7B%7D','/?abertura=0']:
            context,page,errors=await open_page(scripts=[HUMAN,WATCH])
            await page.goto(BASE+path)
            await page.wait_for_load_state('load')
            assert await page.locator('#flow-opening').count()==0,path
            assert not await page.evaluate('window.__openingSeen'),path
            await context.close()
        passed('Regular browsers see it once per session; share, OAuth, capture and abertura=0 skip it')

        await browser.close()
    print(f'{checks} opening checks passed')

asyncio.run(run())
