"""Browser checks for the time BI, CSV export, PDF layout and directional board."""
import asyncio
import os
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
        await page.goto(BASE)
        await expect(page.locator('.pipeline-direction li')).to_have_count(5)
        positions = await page.locator('.pipeline-direction li').evaluate_all('(items)=>items.map(el=>el.getBoundingClientRect().x)')
        assert positions == sorted(positions)
        await page.screenshot(path='/tmp/flow-pipeline-preview.png', full_page=True)
        passed('Connected stages are visibly ordered from left to right')
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
        await page.locator('[data-action="close-modal"]').click()
        await page.emulate_media(media='print')
        await expect(page.locator('.sidebar,.topbar').first).to_be_hidden()
        await expect(page.locator('.time-tasks')).to_be_visible()
        pdf = await page.pdf(path=str(Path(folder) / 'flow-tempo.pdf'), format='A4', print_background=True)
        assert pdf.startswith(b'%PDF') and len(pdf) > 15000
        passed('Print layout produces a PDF with the time analysis and task table')
        await page.emulate_media(media='screen')
        await page.screenshot(path='/tmp/flow-time-preview.png', full_page=True)
        for width in [390, 768, 1440]:
            await page.set_viewport_size({'width':width,'height':1000})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            await expect(page.locator('#time-total')).to_be_visible()
        await page.set_viewport_size({'width':390,'height':1000})
        await page.screenshot(path='/tmp/flow-time-mobile.png', full_page=True)
        passed('Time dashboard fits mobile, tablet and desktop without page overflow')
        await context.close()
        await browser.close()
    print(f'{checks} time-report browser checks passed.', flush=True)


with TemporaryDirectory(prefix='flow-report-test-') as folder:
    asyncio.run(main(folder))
