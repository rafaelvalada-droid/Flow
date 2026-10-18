"""Browser checks for the time BI, CSV export, PDF layout and directional board."""
import asyncio
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')


async def main(folder):
    checks = 0
    def passed(text):
        nonlocal checks
        checks += 1
        print('PASS ' + text, flush=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, timezone_id='America/Sao_Paulo')
        page = await context.new_page()
        await page.clock.install(time=datetime(2026, 10, 10, 18, tzinfo=timezone.utc))
        resource_requests=[]
        page.on('request',lambda r:resource_requests.append(r.url) if '/assets/fonts/' in r.url else None)
        await page.goto(BASE)
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(page.locator('.today-tabs [role="tab"]')).to_have_count(2)
        await page.screenshot(path='/tmp/flow-today-preview.png', full_page=True)
        passed('Hoje opens with the Hoje and Próximos tabs')
        await page.evaluate("""() => {
            const key='flow.workspace.v1', db=JSON.parse(localStorage.getItem(key));
            db.tasks[0].sessions=[{start:+new Date('2026-10-10T09:00:00'),end:+new Date('2026-10-10T09:25:00')}];
            db.tasks[1].sessions=[{start:+new Date('2026-10-09T23:50:00'),end:+new Date('2026-10-10T00:10:00')}];
            db.tasks[2].sessions=[{start:+new Date('2026-10-01T14:00:00'),end:+new Date('2026-10-01T14:30:00')}];
            localStorage.setItem(key,JSON.stringify(db));
            window.dispatchEvent(new StorageEvent('storage',{key}));
        }""")
        await page.locator('#sidebar-nav [data-page="tempo"]').click()
        await expect(page.locator('#time-total')).to_have_text('00:45:00')
        await expect(page.locator('.time-bar')).to_have_count(7)
        await page.locator('[data-time-period="day"]').click()
        await expect(page.locator('#time-total')).to_have_text('00:35:00')
        await expect(page.locator('.time-bar')).to_have_count(24)
        await page.locator('[data-time-period="month"]').click()
        await expect(page.locator('#time-total')).to_have_text('01:15:00')
        await expect(page.locator('.time-bar')).to_have_count(31)
        await expect(page.locator('.time-area')).to_have_count(3)
        await expect(page.locator('.time-tasks tbody tr')).to_have_count(3)
        passed('Day/week/month filters show actual time, including correct midnight splitting')
        await page.locator('[data-action="time-report"]').click()
        async with page.expect_download() as result:
            await page.locator('[data-action="time-csv"]').click()
        download = await result.value
        path = Path(folder) / download.suggested_filename
        await download.save_as(path)
        text = path.read_text(encoding='utf-8-sig')
        assert '"01:15:00";"Segundos";"4500"' in text
        assert '"Carga horária docente";"00:25:00";"1500"' in text
        assert 'Conferir carga horária docente' in text
        passed('Generated CSV contains period totals and detailed time by area and task')
        async with page.expect_download() as result:
            await page.locator('[data-action="time-pdf"]').click()
        download=await result.value
        await download.save_as('/tmp/flow-time-report-designed.pdf')
        pdf=Path('/tmp/flow-time-report-designed.pdf').read_bytes()
        assert pdf.startswith(b'%PDF') and len(pdf)>15000
        extracted=subprocess.check_output(['pdftotext','/tmp/flow-time-report-designed.pdf','-'],text=True)
        assert '01:15:00' in extracted and 'Conferir carga horária docente' in extracted
        async with page.expect_download() as large:
            await page.evaluate("""async () => {
              const report=FlowTime.summarize(JSON.parse(localStorage.getItem('flow.workspace.v1')),'month',0);
              report.tasks=Array.from({length:75},(_,i)=>({title:'Tarefa de relatório '+i+' com descrição longa para verificar a quebra de linhas sem perder conteúdo',area:'Área de teste',ms:60000,sessions:1}));
              await FlowPDF.download(report,'month');
            }""")
        await (await large.value).save_as(str(Path(folder)/'large.pdf'))
        large_text=subprocess.check_output(['pdftotext',str(Path(folder)/'large.pdf'),'-'],text=True)
        assert 'Tarefa de relatório 0' in large_text and 'Tarefa de relatório 74' in large_text
        assert len(resource_requests)==2,'Regular and bold fonts must load only once across both PDF downloads'
        passed('Designed PDF downloads directly, paginates long tasks and reuses fonts on the next export')
        await page.screenshot(path='/tmp/flow-time-preview.png', full_page=True)
        for width in [390, 768, 1440]:
            await page.set_viewport_size({'width':width,'height':1000})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            await expect(page.locator('#time-total')).to_be_visible()
        await page.set_viewport_size({'width':390,'height':1000})
        await page.screenshot(path='/tmp/flow-time-mobile.png', full_page=True)
        passed('Time dashboard fits mobile, tablet and desktop without page overflow')
        await context.close()
        # Chile, 06/09/2026: o relógio passa de 00:00 para 01:00. Nenhum trabalho pode ser contado em dois dias.
        context = await browser.new_context(viewport={'width': 1280, 'height': 900}, timezone_id='America/Santiago')
        page = await context.new_page()
        await page.clock.install(time=datetime(2026, 9, 7, 15, tzinfo=timezone.utc))
        await page.goto(BASE)
        await page.wait_for_function("localStorage.getItem('flow.workspace.v1')")
        await page.evaluate("""() => {
            const key='flow.workspace.v1', db=JSON.parse(localStorage.getItem(key));
            db.tasks.forEach(task=>{task.sessions=[]});
            db.tasks[0].sessions=[{start:+new Date('2026-09-06T01:00:00-03:00'),end:+new Date('2026-09-06T02:00:00-03:00')},
                {start:+new Date('2026-09-06T23:30:00-03:00'),end:+new Date('2026-09-07T00:30:00-03:00')}];
            localStorage.setItem(key,JSON.stringify(db));
            window.dispatchEvent(new StorageEvent('storage',{key}));
        }""")
        await page.locator('#sidebar-nav [data-page="tempo"]').click()
        await page.locator('[data-time-period="day"]').click()
        await expect(page.locator('#time-total')).to_have_text('00:30:00')
        await expect(page.locator('.time-bar')).to_have_count(24)
        await page.locator('[data-action="time-previous"]').click()
        await expect(page.locator('#time-total')).to_have_text('01:30:00')
        await expect(page.locator('.time-bar')).to_have_count(23)
        await page.locator('[data-time-period="week"]').click()
        await expect(page.locator('#time-total')).to_have_text('00:30:00')
        await page.locator('[data-action="time-previous"]').click()
        await expect(page.locator('#time-total')).to_have_text('01:30:00')
        await expect(page.locator('.time-bar')).to_have_count(7)
        passed('A day without local midnight (America/Santiago) starts at 01:00 and never double-counts work')
        await context.close()
        await browser.close()
    print(f'{checks} time-report browser checks passed.', flush=True)


with TemporaryDirectory(prefix='flow-report-test-') as folder:
    asyncio.run(main(folder))
