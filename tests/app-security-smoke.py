"""Browser regressions for escaped workspace data, safe backup import, batched writes and dialogs.

All data is local test data. Faults (render errors, a full browser storage) are injected
through the page's own globals so each recovery path is exercised deterministically.
"""
import asyncio
import json
import os
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
KEY = 'flow.workspace.v1'
AREA = '<img src=x onerror=window.__xss=1>'
PROJECT = '<img src=x onerror=window.__xss=5>'
FLUSHED = "(key)=>{window.dispatchEvent(new Event('flow:persist-flush'));return localStorage.getItem(key)}"


def backup(title, **extra):
    task = {'id': 'imported-task', 'title': title, 'project': 'folha', 'status': 'todo', 'priority': 'medium',
            'dueDate': '2026-10-20', 'plannedDate': '', 'plannedTime': '', 'description': 'Contexto importado',
            'subtasks': [], 'sessions': [], 'startedAt': None, 'createdAt': 1, 'completedAt': None}
    task.update(extra.pop('task', {}))
    data = {'version': 1, 'classificationCatalogVersion': 5,
            'projects': [{'id': 'folha', 'name': 'Folha docente', 'color': '#418d9d'}], 'tasks': [task],
            'preferences': {'focusMinutes': 25, 'breakMinutes': 5, 'reminderDays': 1, 'alerts': [True, True, True, False]}}
    data.update(extra)
    return data


async def import_file(page, data, name='backup.json'):
    """Selects a file in the open Importar backup dialog and submits it."""
    body = data if isinstance(data, bytes) else json.dumps(data).encode()
    form = page.locator('#active-modal-form')
    await form.locator('[name="file"]').set_input_files({'name': name, 'mimeType': 'application/json', 'buffer': body})
    await form.locator('[type="submit"]').click()


async def open_import(page):
    await page.locator('.workspace-settings').click()
    await page.locator('[data-action="import-data"]').click()
    await expect(page.locator('#active-modal-form [name="file"]')).to_be_attached()


async def run(profile):
    checks = 0
    def passed(message):
        nonlocal checks
        checks += 1
        print('PASS ' + message, flush=True)

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(profile, executable_path='/usr/bin/chromium', headless=True,
            args=['--no-sandbox'], viewport={'width': 1280, 'height': 900}, timezone_id='America/Sao_Paulo')
        await context.route('**/api/auth-config', lambda route: route.fulfill(json={'configured': False}))
        # Injeta falhas de exibição controladas pelo teste, depois que os módulos carregam.
        await context.add_init_script("""document.addEventListener('DOMContentLoaded',()=>{
          const info=FlowGmailReview.info;FlowGmailReview.info=()=>{if(sessionStorage.getItem('fail-render'))throw new Error('Falha simulada');return info()};
          const summarize=FlowTime.summarize;FlowTime.summarize=(db,...rest)=>{if(db.tasks.some(t=>t.title==='Quebra de exibição'))throw new Error('Falha simulada');return summarize(db,...rest)};
        });""")
        page = context.pages[0] if context.pages else await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: asyncio.ensure_future(dialog.accept()))
        await page.goto(BASE)
        await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy', 'true')

        await page.locator('#sidebar-nav [data-page="projetos"]').click()
        await page.locator('[data-action="new-project"]').click()
        await page.locator('#active-modal-form [name="name"]').fill(AREA)
        await page.locator('#active-modal-form [type="submit"]').click()
        await page.locator('.projectcard').filter(has_text=AREA).click()
        await expect(page.locator('.page-head h1')).to_have_text(AREA)
        assert await page.locator('.page-head h1 img').count() == 0
        await page.locator('[data-action="new-initiative"]').click()
        await page.locator('#project-editor-form [name="name"]').fill(PROJECT)
        await page.locator('#project-editor-form [type="submit"]').click()
        await expect(page.locator('.page-head h1')).to_have_text(PROJECT)
        assert await page.locator('.page-head img[src="x"]').count() == 0
        await page.wait_for_timeout(200)
        assert await page.evaluate('window.__xss') is None
        passed('Area and project names render as text in page headings')

        hostile = backup('Tarefa importada', task={'focusCycles': '<img src=x onerror=window.__xss=2>'},
                         preferences={'focusMinutes': '<img src=x onerror=window.__xss=6>', 'breakMinutes': '"><img src=x onerror=window.__xss=7>',
                                      'reminderDays': '<b>', 'alerts': ['"><img src=x onerror=window.__xss=3>', True, 'x', None]})
        await open_import(page)
        await import_file(page, hostile)
        await expect(page.locator('#modal-backdrop')).to_have_class('modal-backdrop hidden')
        await expect(page.locator('#toast')).to_have_text('Backup importado com sucesso.')
        await page.locator('#sidebar-nav [data-page="foco"]').click()
        await expect(page.locator('.focus-task-title')).to_have_text('Tarefa importada')
        await expect(page.locator('.focus-total')).to_contain_text('0 ciclos completos')
        assert await page.locator('#focus-minutes').input_value() == '25'
        await page.locator('#sidebar-nav [data-page="alertas"]').click()
        assert await page.locator('[data-alert]').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("aria-checked"))') == ['true', 'true', 'true', 'false']
        assert await page.locator('#screen img[src="x"]').count() == 0
        await page.wait_for_timeout(200)
        assert await page.evaluate('window.__xss') is None
        saved = json.loads(await page.evaluate(FLUSHED, KEY))
        assert saved['tasks'][0]['focusCycles'] == 0 and saved['preferences']['alerts'] == [True, True, True, False]
        passed('Imported markup in cycles, rhythm and alert preferences is normalized and never executes')

        before = await page.evaluate(FLUSHED, KEY)
        await open_import(page)
        await import_file(page, {'version': 1, 'projects': [], 'tasks': [], 'archivedProjects': {}, 'classificationCatalogVersion': 5})
        await expect(page.locator('#toast')).to_contain_text('Backup inválido ou incompatível')
        await import_file(page, b'{"version":1,')
        await expect(page.locator('#toast')).to_contain_text('Backup inválido ou incompatível')
        await import_file(page, backup('Quebra de exibição'))
        await expect(page.locator('#toast')).to_contain_text('não pôde ser aberto')
        assert await page.evaluate(FLUSHED, KEY) == before
        await expect(page.locator('#active-modal-form')).to_be_visible()
        await page.locator('[data-action="close-modal"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-date-filter').select_option('all')
        await expect(page.locator('.pipeline-task').filter(has_text='Tarefa importada')).to_be_visible()
        await page.locator('#sidebar-nav [data-page="tempo"]').click()
        await expect(page.locator('#time-total')).to_be_visible()
        passed('Malformed, unreadable or unrenderable backups leave the stored workspace and the UI intact')

        await open_import(page)
        await import_file(page, {**backup('Primeira tentativa inválida'), 'tasks': 'x'})
        await expect(page.locator('#toast')).to_contain_text('Backup inválido ou incompatível')
        await import_file(page, backup('Segunda tentativa válida'))
        await expect(page.locator('#modal-backdrop')).to_have_class('modal-backdrop hidden')
        assert json.loads(await page.evaluate(FLUSHED, KEY))['tasks'][0]['title'] == 'Segunda tentativa válida'
        passed('A second attempt in the same import dialog works after a rejected file')

        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-date-filter').select_option('all')
        demand = page.locator('.pipeline-task').filter(has_text='Segunda tentativa válida')
        await demand.locator('summary').click()
        await demand.locator('[data-action="task-detail"]').click()
        await page.evaluate("""(key)=>{window.__writes=0;const set=Storage.prototype.setItem;
          Storage.prototype.setItem=function(name,value){if(name===key)window.__writes++;return set.call(this,name,value)}}""", KEY)
        field = page.locator('#edit-description')
        await field.click()
        await field.press('End')
        typed = ' digitado sem gravar a cada tecla'
        await page.keyboard.type(typed, delay=5)
        writes = await page.evaluate('window.__writes')
        assert writes <= 2, writes
        stored = json.loads(await page.evaluate(FLUSHED, KEY))
        assert stored['tasks'][0]['description'] == 'Contexto importado' + typed
        assert await page.evaluate('window.__writes') <= writes + 1
        await page.keyboard.type(' e salvo ao recarregar', delay=5)
        await page.reload()
        await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy', 'true')
        stored = json.loads(await page.evaluate('(key)=>localStorage.getItem(key)', KEY))
        assert stored['tasks'][0]['description'] == 'Contexto importado' + typed + ' e salvo ao recarregar'
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-date-filter').select_option('all')
        await demand.locator('summary').click()
        await demand.locator('[data-action="task-detail"]').click()
        await field.click()
        await field.press('End')
        await page.keyboard.type(' e ao sair do campo', delay=5)
        await field.blur()
        stored = json.loads(await page.evaluate('(key)=>localStorage.getItem(key)', KEY))
        assert stored['tasks'][0]['description'].endswith(' e ao sair do campo')
        passed('Typing batches local writes; flush event, reload and blur still persist the description')

        await page.evaluate("""(key)=>{window.__queued=0;const queue=FlowCloud.queue;FlowCloud.queue=(...args)=>{window.__queued++;return queue(...args)};
          window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Cota excedida','QuotaExceededError');return window.__setItem.call(this,name,value)}}""", KEY)
        await page.locator('#sidebar-nav [data-page="alertas"]').click()
        await page.locator('[data-alert="3"]').click()
        await expect(page.locator('#toast')).to_contain_text('armazenamento deste navegador está cheio')
        assert await page.evaluate('window.__queued') >= 1
        await expect(page.locator('[data-alert="3"]')).to_have_attribute('aria-checked', 'true')
        await page.evaluate('()=>{Storage.prototype.setItem=window.__setItem}')
        passed('A full browser storage shows a specific notice and still hands the change to the cloud queue')

        opener = page.locator('.top-actions [data-action="new-task"]')
        await opener.click()
        assert await page.locator('.app-shell').evaluate('(node)=>node.inert')
        assert await page.evaluate("document.activeElement.name") == 'title'
        await page.keyboard.press('Shift+Tab')
        assert await page.evaluate("document.activeElement.type") == 'submit'
        await page.keyboard.press('Tab')
        assert await page.evaluate("document.activeElement.name") == 'title'
        for _ in range(12):
            await page.keyboard.press('Tab')
            assert await page.evaluate("!!document.activeElement.closest('.modal')")
        await page.keyboard.press('Escape')
        await expect(page.locator('#modal-backdrop')).to_have_class('modal-backdrop hidden')
        assert not await page.locator('.app-shell').evaluate('(node)=>node.inert')
        assert await page.evaluate("document.activeElement.dataset.action") == 'new-task'
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-date-filter').select_option('all')
        await page.locator('[data-drag-task]').first.click()
        await expect(page.locator('#active-modal-form [name="stage"]')).to_be_focused()
        await page.locator('[data-action="close-modal"]').click()
        assert await page.evaluate("document.activeElement.hasAttribute('data-drag-task')")
        passed('Dialogs make the app inert, trap Tab, close with Escape and return focus to the opener')

        await page.evaluate("""()=>{window.__ranges=[];const show=FlowCalendar.showRange;FlowCalendar.showRange=(...args)=>{window.__ranges.push(args[0]??null);return show(...args)}}""")
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        ranges = await page.evaluate('window.__ranges')
        assert ranges and ranges[0] is not None and ranges[-1] is None, ranges
        passed('Leaving Agenda tells the calendar to stop reading the visible week')

        await page.evaluate("sessionStorage.setItem('fail-render','1')")
        await page.reload()
        await expect(page.locator('.page-head h1')).to_have_text('Não foi possível abrir esta tela')
        assert not await page.locator('.sidebar').evaluate('(node)=>node.inert')
        await page.locator('.workspace-settings').click()
        await expect(page.locator('[data-action="import-data"]')).to_be_visible()
        await page.locator('[data-action="close-modal"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        await page.evaluate("sessionStorage.removeItem('fail-render')")
        passed('A failing first screen still unlocks the menu and keeps Dados do UlbraFlow reachable')

        await page.evaluate("(key)=>localStorage.setItem(key,'{ilegível')", KEY)
        await page.reload()
        await expect(page.locator('.page-head h1')).to_have_text('Não foi possível abrir seus dados')
        assert not await page.locator('.sidebar').evaluate('(node)=>node.inert')
        await page.locator('.top-actions [data-action="new-task"]').click()
        await page.locator('#active-modal-form [name="title"]').fill('Não deve sobrescrever')
        await page.locator('#active-modal-form [type="submit"]').click()
        await expect(page.locator('#toast')).to_contain_text('foram preservados')
        assert await page.evaluate(FLUSHED, KEY) == '{ilegível'
        async with page.expect_download() as exported:
            await page.locator('.workspace-settings').click()
            await page.locator('[data-action="export-data"]').click()
        assert (await (await exported.value).path()).read_text() == '{ilegível'
        await page.locator('[data-action="import-data"]').click()
        await import_file(page, backup('Recuperado do backup'))
        await expect(page.locator('#modal-backdrop')).to_have_class('modal-backdrop hidden')
        assert json.loads(await page.evaluate(FLUSHED, KEY))['tasks'][0]['title'] == 'Recuperado do backup'
        passed('Unreadable stored data is preserved, exportable and replaced only by an explicit import')

        assert not errors, errors
        passed('No uncaught JavaScript errors')
        await context.close()
    print(f'{checks} app security browser checks passed.', flush=True)


with TemporaryDirectory(prefix='flow-app-security-') as profile:
    asyncio.run(run(profile))
