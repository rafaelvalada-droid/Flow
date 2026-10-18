"""Runs the app under the production Content-Security-Policy served by server.mjs (local mode).

Exercises every page, the PDF report (jsPDF + embedded fonts), CSV/JSON/project downloads,
service worker, Web Share Target, the offline page and framing, and fails on any CSP violation.
page.wait_for_function is not used: Playwright compiles it with eval, which the policy blocks.
"""
import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000').rstrip('/')
PAGES = ['entrada', 'hoje', 'foco', 'projetos', 'agenda', 'meus-projetos', 'alertas', 'tempo']


async def main(folder):
    checks = 0
    def passed(text):
        nonlocal checks
        checks += 1
        print('PASS ' + text, flush=True)
    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(str(Path(folder) / 'profile'), executable_path='/usr/bin/chromium', headless=True,
                                                              args=['--no-sandbox'], accept_downloads=True, viewport={'width': 1440, 'height': 1000})
        violations, errors = [], []
        await context.expose_function('__flowCspViolation', lambda text: violations.append(text))
        await context.add_init_script("document.addEventListener('securitypolicyviolation',e=>window.__flowCspViolation(e.effectiveDirective+' '+e.blockedURI+' '+e.sourceFile+':'+e.lineNumber))")
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: violations.append(message.text) if 'Content Security Policy' in message.text else None)
        response = await page.goto(BASE + '/')
        headers = await response.all_headers()
        assert "script-src 'self'" in headers['content-security-policy'] and headers['x-frame-options'] == 'DENY'
        await expect(page.locator('.sidebar')).not_to_have_attribute('inert', '')
        for name in PAGES:
            await page.locator(f'#sidebar-nav [data-page="{name}"]').click()
            await expect(page.locator('#screen')).not_to_be_empty()
        await page.locator('.top-actions [data-action="new-task"]').click()
        await expect(page.locator('#active-modal-form')).to_be_visible()
        await page.locator('[data-action="close-modal"]').first.click()
        allowed = await page.evaluate("document.featurePolicy?[document.featurePolicy.allowsFeature('microphone'),document.featurePolicy.allowsFeature('camera'),document.featurePolicy.allowsFeature('geolocation')]:null")
        assert allowed in (None, [True, False, False]), allowed
        passed('All pages, the new-demand form and the dictation microphone permission work under the CSP')

        await page.locator('#sidebar-nav [data-page="tempo"]').click()
        await page.locator('[data-action="time-report"]').click()
        async with page.expect_download() as result:
            await page.locator('[data-action="time-csv"]').click()
        assert (await result.value).suggested_filename.endswith('.csv')
        async with page.expect_download() as result:
            await page.locator('[data-action="time-pdf"]').click()
        pdf = Path(folder) / 'report.pdf'
        await (await result.value).save_as(pdf)
        assert pdf.read_bytes().startswith(b'%PDF') and pdf.stat().st_size > 15000
        passed('The PDF report loads vendor/jsPDF and the embedded fonts without eval; CSV downloads')

        await page.keyboard.press('Escape')
        await page.locator('[data-action="settings"]').click()
        async with page.expect_download() as result:
            await page.locator('[data-action="export-data"]').click()
        assert (await result.value).suggested_filename.endswith('.json')
        await page.keyboard.press('Escape')
        await page.locator('.project-nav-menu summary').click()
        await page.locator('[data-project-model="pdca"]').click()
        await page.locator('#project-editor-form [name="name"]').fill('Projeto sob CSP')
        await page.locator('#project-editor-form [name="areaId"]').select_option(index=1)
        await page.locator('#project-editor-form [type="submit"]').click()
        async with page.expect_download() as result:
            await page.locator('[data-action="project-export"]').click()
        assert (await result.value).suggested_filename.endswith('.html')
        passed('Backup JSON and the project HTML export (Blob) download under the CSP')

        await page.evaluate('navigator.serviceWorker.ready.then(()=>navigator.serviceWorker.controller||new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true})))')
        await page.evaluate('''() => {const form=document.createElement('form');form.method='POST';form.enctype='multipart/form-data';form.action='/share-target';
            for(const [name,value] of Object.entries({title:'Compartilhado sob CSP',text:'Texto recebido',url:'https://example.com/a'})){const input=document.createElement('input');input.name=name;input.value=value;form.append(input);}
            document.body.append(form);form.submit();}''')
        await expect(page.locator('#active-modal-form [name="title"]')).to_have_value('Compartilhado sob CSP')
        passed('The service worker controls the page and the Web Share Target POST opens the review form')

        await page.goto(BASE + '/offline.html')
        await page.get_by_text('Tentar novamente').click()
        await expect(page).to_have_url(BASE + '/')
        passed('The offline page retries with a plain link (no inline script)')

        framer = await context.new_page()
        await framer.goto('about:blank')
        await framer.set_content(f'<iframe src="{BASE}/"></iframe>')
        await framer.wait_for_timeout(500)
        child = framer.frames[1].url if len(framer.frames) > 1 else ''
        # Chromium replaces a frame refused by frame-ancestors / X-Frame-Options with its error page.
        assert child.startswith('chrome-error://'), child
        await framer.close()
        passed('Other sites cannot embed UlbraFlow in a frame')

        assert not errors, errors
        assert not violations, violations
        passed('No Content-Security-Policy violations in the whole session')
        await context.close()
    print(f'{checks} CSP browser checks passed.', flush=True)


with TemporaryDirectory(prefix='flow-csp-') as folder:
    asyncio.run(main(folder))
