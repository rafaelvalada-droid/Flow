"""Browser integration checks with simulated Gmail and a Chrome API adapter.

The managed cloud Chromium blocks unpacked extensions. These checks execute
the real UI/background/bridge code with an adapter for chrome.*; they do not
claim to validate native Chrome extension loading or a real Gmail account.
Requires Python Playwright and Chromium; never accesses external services.
"""
import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extensao-chrome'
FLOW = 'https://flow-blue-theta.vercel.app/'
GMAIL = 'https://mail.google.com/mail/u/0/#inbox/abcdefghijklmnop'
THREAD = '18b2c3d4e5f6a7b8'
# Link canônico: conta pelo authuser e conversa pelo ID da Gmail API, não pela posição na caixa.
CANONICAL = 'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/' + THREAD
ID = 'flow-test-extension'


class ChromeAdapter:
    """Use real browser pages and storage behind the mocked Chrome transport."""
    def __init__(self, context):
        self.context = context
        self.pages = {}
        self.background = None
        self.next_id = 1
        self.active_id = None
        self.flow_url = FLOW
        self.allowed = True
        self.openers = {}
        self.focused_windows = []

    def register(self, page, active=False, opener=None):
        tab_id = self.next_id
        self.next_id += 1
        self.pages[tab_id] = page
        if opener is not None:
            self.openers[tab_id] = opener
        if active:
            self.active_id = tab_id
        return tab_id

    def tab(self, tab_id):
        page = self.pages[tab_id]
        tab = {'id': tab_id, 'url': page.url, 'status': 'complete', 'active': tab_id == self.active_id, 'windowId': 1}
        if tab_id in self.openers:
            tab['openerTabId'] = self.openers[tab_id]
        return tab

    async def api(self, source, request):
        kind = request['kind']
        data = request.get('data')
        if kind == 'storage.get':
            return {'flowUrl': self.flow_url}
        if kind == 'permissions.contains':
            return self.allowed
        if kind == 'tabs.query':
            return [self.tab(i) for i, p in self.pages.items() if p.url.startswith(self.flow_url)]
        if kind == 'tabs.create':
            page = await self.context.new_page()
            tab_id = self.register(page, active=data.get('active', True))
            await page.goto(data['url'])
            return self.tab(tab_id)
        if kind == 'tabs.update':
            self.active_id = data['tabId']
            return self.tab(self.active_id)
        if kind == 'tabs.get':
            return self.tab(data)
        if kind == 'tabs.remove':
            page = self.pages.pop(data)
            self.openers.pop(data, None)
            await page.close()
            return None
        if kind == 'windows.update':
            self.focused_windows.append(data['windowId'])
            return {'id': data['windowId'], 'focused': True}
        if kind == 'scripting.executeScript':
            page = self.pages[data['target']['tabId']]
            await page.evaluate("""id => {
                window.__bridgeListeners = window.__bridgeListeners || [];
                window.chrome = {runtime: {id, onMessage: {addListener: fn => window.__bridgeListeners.push(fn)}}};
            }""", ID)
            for file in data['files']:
                await page.add_script_tag(content=(EXT / file).read_text())
            return []
        if kind == 'tabs.sendMessage':
            return await self.bridge(data['tabId'], data['message'])
        if kind == 'runtime.sendMessage':
            page = source['page']
            tab_id = next(i for i, p in self.pages.items() if p == page)
            return await self.dispatch(data, {'id': ID, 'url': page.url, 'tab': self.tab(tab_id), 'frameId': 0})
        raise AssertionError('Unexpected Chrome API: ' + kind)

    async def dispatch(self, message, sender):
        return await self.background.evaluate("""({message,sender}) => new Promise(resolve => {
            const listener = window.__backgroundListener;
            let responded = false;
            const response = value => {responded = true;resolve(value);};
            const pending = listener(message,sender,response);
            if (pending !== true && !responded) resolve(null);
        })""", {'message': message, 'sender': sender})

    async def bridge(self, tab_id, message):
        return await self.pages[tab_id].evaluate("""({message,id}) => new Promise(resolve => {
            let answered = false;
            let pending = false;
            for (const listener of window.__bridgeListeners || []) {
                if (listener(message,{id},value => {answered = true;resolve(value);}) === true) pending = true;
            }
            if (!answered && !pending) resolve(null);
        })""", {'message': message, 'id': ID})

    async def initialize(self):
        await self.context.expose_binding('__chromeApi', self.api)
        self.background = await self.context.new_page()
        await self.background.goto('http://flow-extension.test/')
        await self.background.evaluate("""id => {
            const call = (kind,data) => window.__chromeApi({kind,data});
            window.chrome = {
                runtime: {id, onMessage: {addListener: fn => {window.__backgroundListener = fn;}}},
                storage: {local: {get: key => call('storage.get',key)}},
                permissions: {contains: value => call('permissions.contains',value)},
                tabs: {
                    query: value => call('tabs.query',value),
                    create: value => call('tabs.create',value),
                    get: value => call('tabs.get',value),
                    update: (tabId,options) => call('tabs.update',{tabId,options}),
                    remove: tabId => call('tabs.remove',tabId),
                    sendMessage: (tabId,message) => call('tabs.sendMessage',{tabId,message})
                },
                windows: {update: (windowId,options) => call('windows.update',{windowId,options})},
                scripting: {executeScript: value => call('scripting.executeScript',value)}
            };
            window.importScripts = () => {};
        }""", ID)
        await self.background.add_script_tag(content=(EXT / 'shared.js').read_text())
        await self.background.add_script_tag(content=(EXT / 'background.js').read_text())

    async def gmail(self, page):
        await page.evaluate("""() => {
            window.chrome = {runtime: {sendMessage: message => window.__chromeApi({kind:'runtime.sendMessage',data:message})}};
        }""")
        await page.add_script_tag(content=(EXT / 'gmail.js').read_text())


async def main(profile):
    checks = 0
    def passed(message):
        nonlocal checks
        checks += 1
        print(f'PASS {checks}: {message}', flush=True)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            profile, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
            headless=True, args=['--no-sandbox'], timezone_id='America/Sao_Paulo')
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))

        async def serve(route):
            url = urlsplit(route.request.url)
            if url.hostname == 'flow-blue-theta.vercel.app' and url.path == '/api/auth-config':
                await route.fulfill(content_type='application/json', body='{"configured":false}')
                return
            if url.hostname == 'mail.google.com':
                await route.fulfill(content_type='text/html', body=f'''<!doctype html><html><head><title>Planejamento da semana - user@ulbra.br - Gmail</title></head><body>
                  <main><div class="ha"><h2 class="hP" data-thread-perm-id="thread-f:{int(THREAD, 16)}" data-legacy-thread-id="{THREAD}" data-legacy-last-non-draft-message-id="18b2c3d4e5f6a7c0">Planejamento da semana</h2></div>
                  <span class="gD" email="coordenacao@example.test">Coordenação</span>
                  <p>Mensagem simulada, sem acesso a e-mails reais.</p></main></body></html>''')
            elif url.hostname == 'flow-blue-theta.vercel.app':
                file = ROOT / ('index.html' if url.path == '/' else url.path.lstrip('/'))
                if file.is_file():
                    await route.fulfill(path=str(file))
                else:
                    await route.fulfill(status=404, body='Not found')
            elif url.hostname == 'flow-extension.test':
                await route.fulfill(content_type='text/html', body='<html><body>Extension harness</body></html>')
            else:
                await route.abort()

        await context.route('**/*', serve)
        adapter = ChromeAdapter(context)
        await adapter.initialize()
        gmail = await context.new_page()
        gmail_id = adapter.register(gmail, active=True)
        await gmail.goto(GMAIL)
        await adapter.gmail(gmail)
        button = gmail.locator('#flow-gmail-button button')
        await expect(button).to_be_visible()
        await button.click()
        select = gmail.locator('#flow-gmail-dialog select')
        await expect(select).to_be_enabled(timeout=25000)
        assert await select.locator('option').count() == 13
        assert adapter.active_id == gmail_id and gmail.url == GMAIL
        passed('Button opens a Gmail dialog and loads actual Flow projects without leaving Gmail')

        await gmail.keyboard.press('Escape')
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(0)
        await button.click()
        await expect(select).to_be_enabled()
        await gmail.locator('#flow-gmail-dialog [name="title"]').click()
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(1)
        await gmail.mouse.click(5, 5)
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(0)
        await button.click()
        await expect(select).to_be_enabled()
        passed('Escape and outside click close the dialog; inside clicks keep it open and reopening works')

        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-10')
        await gmail.locator('#flow-gmail-dialog [name="title"]').fill('Organizar planejamento')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Salvo no UlbraFlow')
        flow_id = next(i for i, page in adapter.pages.items() if page.url.startswith(FLOW))
        flow = adapter.pages[flow_id]
        db = await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1'))")
        task = next(t for t in db['tasks'] if t['title'] == 'Organizar planejamento')
        assert task['dueDate'] == '2026-12-10'
        assert task['project'] == 'oferta' and task['gmailSubject'] == 'Planejamento da semana'
        assert task['gmailSender'] == 'coordenacao@example.test' and task['gmailUrl'] == CANONICAL
        assert task['gmailThreadId'] == THREAD and task['gmailMessageId'] == '18b2c3d4e5f6a7c0'
        assert len(db['tasks']) == 5
        await flow.locator('#sidebar-nav [data-page="esteira"]').click()
        await flow.locator('#board-date-filter').select_option('all')
        await expect(flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')).to_be_visible()
        passed('Save writes the chosen project, title, sender, Gmail API thread ID and canonical link; Flow updates immediately')
        demand = flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')
        await expect(demand.get_by_role('button', name='Abrir Gmail')).to_be_hidden()
        await demand.locator('summary').click()
        await expect(demand.get_by_role('button', name='Abrir Gmail')).to_be_visible()
        await demand.locator('summary').click()
        await expect(demand.get_by_role('button', name='Abrir Gmail')).to_be_hidden()
        await demand.locator('summary').click()
        passed('Demand accordion starts compact, expands its actions and collapses on another click')
        async with flow.expect_popup() as popup_info:
            await flow.locator('.pipeline-task').filter(has_text='Organizar planejamento').get_by_role('button', name='Abrir Gmail').click()
        email_page = await popup_info.value
        await email_page.wait_for_url(CANONICAL)
        await email_page.close()
        passed('The explicit Abrir Gmail button on the pipeline card opens the original conversation')

        await gmail.get_by_role('button', name='Ver no UlbraFlow').click()
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(0)
        assert adapter.active_id == flow_id
        passed('Ver no Flow activates the destination tab and closes the Gmail dialog')

        replay = {'requestId': task['gmailCaptureId'], 'projectId': 'oferta', 'title': task['title'],
                  'gmailUrl': GMAIL, 'gmailSubject': task['gmailSubject'], 'gmailSender': task['gmailSender']}
        for _ in range(2):
            result = await adapter.bridge(flow_id, {'type': 'FLOW_BRIDGE_SAVE', 'data': replay})
            assert result['ok'] and result['taskId'] == task['id']
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == 5
        passed('Retrying the same save does not duplicate the task')

        await button.click()
        await expect(select).to_be_enabled()
        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-12')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('já está no UlbraFlow')
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == 5
        await gmail.get_by_role('button', name='Ver no UlbraFlow').click()
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(0)
        assert adapter.active_id == flow_id
        mobile = {'requestId': '9b1c4a5e-1111-4222-8333-944455556666', 'projectId': 'oferta', 'title': 'Outra',
                  'gmailUrl': 'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/18b2c3d4e5f6a7ff',
                  'gmailThreadId': '18b2c3d4e5f6a7ff'}
        await flow.evaluate("""() => {const db=JSON.parse(localStorage.getItem('flow.workspace.v1'));db.tasks.push({id:'from-phone',title:'Celular',project:'oferta',status:'todo',gmailCaptureId:'gmail-mobile-18b2c3d4e5f6a7ff'});const next=JSON.stringify(db);localStorage.setItem('flow.workspace.v1',next);window.dispatchEvent(new StorageEvent('storage',{key:'flow.workspace.v1',newValue:next,storageArea:localStorage}));}""")
        result = await adapter.bridge(flow_id, {'type': 'FLOW_BRIDGE_SAVE', 'data': mobile})
        assert result['ok'] and result['duplicate'] and result['taskId'] == 'from-phone'
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == 6
        passed('Capturing a conversation already in Flow (extension or phone) returns the existing task instead of a duplicate')

        # Incluir e arquivar: depois de salvo, o botão Arquivar do próprio Gmail é usado e o Gmail volta para a lista.
        await gmail.evaluate("""() => {const b=document.createElement('div');b.id='fake-archive';b.setAttribute('role','button');b.setAttribute('act','7');b.setAttribute('aria-label','Arquivar');b.textContent='Arquivar';b.addEventListener('click',()=>{window.__archived=(window.__archived||0)+1;location.hash='#inbox';});document.body.prepend(b);}""")
        archive_box = gmail.locator('#flow-gmail-dialog [name="archive"]')
        tasks_before = await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length")
        await button.click()
        await expect(select).to_be_enabled()
        await expect(archive_box).to_be_checked()
        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-12')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-gmail-dialog')).to_have_count(0)
        assert await gmail.evaluate('window.__archived') == 1 and await gmail.evaluate('location.hash') == '#inbox'
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == tasks_before
        passed('Incluir no UlbraFlow saves first and then archives with Gmail\'s own Archive button, returning to the inbox')

        await gmail.evaluate("location.hash = '#inbox/abcdefghijklmnop'")
        await expect(button).to_have_count(1)
        await button.click()
        await expect(select).to_be_enabled()
        await archive_box.uncheck()
        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-12')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('já está no UlbraFlow')
        assert await gmail.evaluate('window.__archived') == 1 and await gmail.evaluate('location.hash') == '#inbox/abcdefghijklmnop'
        await gmail.locator('#flow-close').click()
        passed('With Arquivar unchecked the email stays in the inbox')

        await gmail.evaluate("document.getElementById('fake-archive').remove()")
        await button.click()
        await expect(select).to_be_enabled()
        await expect(archive_box).to_be_checked()
        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-12')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('já está no UlbraFlow')
        await expect(gmail.locator('#flow-status')).to_contain_text('O e-mail não foi arquivado: conecte o Gmail na Entrada do UlbraFlow')
        await expect(gmail.get_by_role('button', name='Ver no UlbraFlow')).to_be_visible()
        assert await gmail.evaluate('location.hash') == '#inbox/abcdefghijklmnop'
        await gmail.locator('#flow-close').click()
        passed('Without the Gmail button or a Gmail connection in Flow the task stays saved and the user is told the email was not archived')

        def stored_status(task_id):
            return flow.evaluate("id => JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.find(t=>t.id===id).status", task_id)
        await flow.locator('#sidebar-nav [data-page="esteira"]').click()
        # Filtro escolhido pelo usuário antes de ir ao Gmail: precisa continuar igual na volta.
        await flow.locator('#board-date-filter').select_option('specific')
        await flow.locator('#board-specific-date').fill('2026-12-10')
        await flow.locator('#board-specific-date').dispatch_event('change')
        demand = flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')
        if not await demand.get_by_role('button', name='Abrir Gmail').is_visible():
            await demand.locator('summary').click()
        async with flow.expect_popup() as popup_info:
            await demand.get_by_role('button', name='Abrir Gmail').click()
        email_page = await popup_info.value
        await email_page.wait_for_url(CANONICAL)
        email_id = adapter.register(email_page, active=True, opener=flow_id)
        await adapter.gmail(email_page)
        finish = email_page.locator('#flow-gmail-complete button')
        await expect(finish).to_have_text('✓ Concluir e voltar ao UlbraFlow', timeout=15000)
        assert await stored_status(task['id']) != 'done'
        async with email_page.expect_event('close'):
            await finish.click()
        assert email_id not in adapter.pages and adapter.active_id == flow_id and adapter.focused_windows[-1] == 1
        assert await stored_status(task['id']) == 'done'
        await expect(flow.locator('.page-head h1')).to_have_text('Detalhe da tarefa')
        await expect(flow.get_by_role('button', name='← Reabrir tarefa')).to_be_visible()
        await flow.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(flow.locator('#board-date-filter')).to_have_value('specific')
        await expect(flow.locator('#board-specific-date')).to_have_value('2026-12-10')
        await expect(flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')).to_have_count(1)
        # Ver no UlbraFlow (flow:open-capture) também abre a tarefa sem trocar o filtro da esteira.
        open_task = "id => window.dispatchEvent(new CustomEvent('flow:open-capture',{detail:{taskId:id}}))"
        await flow.evaluate(open_task, task['id'])
        await expect(flow.locator('.page-head h1')).to_have_text('Detalhe da tarefa')
        await flow.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(flow.locator('#board-date-filter')).to_have_value('specific')
        await flow.evaluate(open_task, task['id'])
        await expect(flow.get_by_role('button', name='← Reabrir tarefa')).to_be_visible()
        passed('Concluir e voltar ao UlbraFlow in a conversation opened by Flow completes the task, returns to Flow, closes that tab and keeps the board filter')

        await flow.get_by_role('button', name='← Reabrir tarefa').click()
        assert await stored_status(task['id']) != 'done'
        main_finish = gmail.locator('#flow-gmail-complete button')
        await expect(main_finish).to_be_visible()
        adapter.active_id = gmail_id
        await main_finish.click()
        await expect(gmail.locator('#flow-gmail-complete')).to_have_count(0)
        assert not gmail.is_closed() and gmail_id in adapter.pages and adapter.active_id == flow_id
        assert await gmail.evaluate('location.hash') == '#inbox'
        assert await stored_status(task['id']) == 'done'
        await gmail.evaluate("location.hash = '#inbox/abcdefghijklmnop'")
        await expect(button).to_have_count(1)
        await expect(gmail.locator('#flow-gmail-complete')).to_have_count(0)
        passed('In the main Gmail tab the task is completed and Gmail returns to the inbox without closing the tab; done tasks show no button')

        await flow.reload()
        await flow.locator('#sidebar-nav [data-page="esteira"]').click()
        await flow.locator('#board-date-filter').select_option('all')
        await expect(flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')).to_be_visible()
        await flow.locator('#sidebar-nav [data-page="projetos"]').click()
        await flow.locator('[data-action="new-project"]').click()
        await flow.locator('#active-modal-form [name="name"]').fill('Minha nova lista')
        await flow.locator('#active-modal-form [type="submit"]').click()
        # Outra conversa: a mesma já está no UlbraFlow e seria reconhecida antes da área.
        await gmail.evaluate("document.querySelector('h2.hP').setAttribute('data-legacy-thread-id','18b2c3d4e5f6a7c1')")
        await button.click()
        await expect(select.locator('option').filter(has_text='Minha nova lista')).to_have_count(1)
        passed('Tasks persist across reload and newly created projects are available on the next capture')

        await select.select_option('suporte')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-11')
        await flow.evaluate("""() => {
          const db=JSON.parse(localStorage.getItem('flow.workspace.v1'));
          db.projects=db.projects.filter(p=>p.id!=='suporte');
          localStorage.setItem('flow.workspace.v1',JSON.stringify(db));
        }""")
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Essa área foi removida')
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == 6
        passed('A deleted list is rejected without saving into a wrong project')
        await gmail.locator('#flow-close').click()

        adapter.allowed = False
        await button.click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Autorize o endereço')
        await expect(gmail.locator('#flow-gmail-dialog [type="submit"]')).to_be_disabled()
        await gmail.locator('#flow-close').click()
        adapter.allowed = True
        passed('Missing site permission displays an actionable error and prevents saving')

        await gmail.evaluate("location.hash='inbox'")
        await expect(gmail.locator('#flow-gmail-button')).to_have_count(0)
        decimal = '1781234567890123456'
        await gmail.evaluate("""decimal => {
          const heading=document.querySelector('h2.hP');
          heading.textContent='Outro assunto <script>literal</script>';
          heading.removeAttribute('data-legacy-thread-id');heading.removeAttribute('data-legacy-last-non-draft-message-id');
          heading.setAttribute('data-thread-perm-id','thread-f:'+decimal);
          history.replaceState(null,'','/mail/u/1/#inbox/qrstuvwxyzabcdef');document.title='Gmail';
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }""", decimal)
        await expect(button).to_have_count(1)
        await button.click()
        await expect(gmail.locator('#flow-gmail-dialog [name="title"]')).to_have_value('Outro assunto <script>literal</script>')
        await expect(select).to_be_enabled()
        passed('Gmail navigation removes/recreates one button and safely captures the current subject')
        await select.select_option('oferta')
        await gmail.locator('#flow-gmail-dialog [name="dueDate"]').fill('2026-12-13')
        await gmail.locator('#flow-gmail-dialog [type="submit"]').click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Salvo no UlbraFlow')
        converted = await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks[0]")
        hexadecimal = format(int(decimal), 'x')
        assert converted['gmailThreadId'] == hexadecimal and 'gmailMessageId' not in converted
        assert converted['gmailUrl'] == 'https://mail.google.com/mail/u/1/#all/' + hexadecimal
        await gmail.locator('#flow-close').click()
        await button.click()
        await expect(select).to_be_enabled()
        passed('thread-f:<decimal> becomes the hex API thread ID; without the account in the title the /u/N/ index is kept')

        await flow.evaluate("""() => {const db=JSON.parse(localStorage.getItem('flow.workspace.v1'));db.projects=[];localStorage.setItem('flow.workspace.v1',JSON.stringify(db));}""")
        await gmail.locator('#flow-close').click()
        await button.click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Crie uma área no UlbraFlow')
        await expect(gmail.locator('#flow-gmail-dialog [type="submit"]')).to_be_disabled()
        passed('An empty list collection cannot create an orphan task')

        denied = await adapter.dispatch({'type': 'FLOW_LISTS'}, {'id': ID, 'url': 'https://example.test/', 'tab': {'id': gmail_id}, 'frameId': 0})
        assert not denied['ok']
        denied_frame = await adapter.dispatch({'type': 'FLOW_LISTS'}, {'id': ID, 'url': GMAIL, 'tab': {'id': gmail_id}, 'frameId': 1})
        assert not denied_frame['ok']
        passed('Background rejects requests from unrelated sites and subframes')
        assert not errors, errors
        passed('No uncaught JavaScript errors in the complete simulated workflow')
        await context.close()
    print(f'{checks} browser checks passed. Native extension loading and a real Gmail account remain untested.', flush=True)


with TemporaryDirectory(prefix='flow-gmail-test-') as profile:
    asyncio.run(main(profile))
