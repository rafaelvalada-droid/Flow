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

    def register(self, page, active=False):
        tab_id = self.next_id
        self.next_id += 1
        self.pages[tab_id] = page
        if active:
            self.active_id = tab_id
        return tab_id

    def tab(self, tab_id):
        page = self.pages[tab_id]
        return {'id': tab_id, 'url': page.url, 'status': 'complete', 'active': tab_id == self.active_id}

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
            return await self.dispatch(data, {'id': ID, 'url': page.url, 'tab': {'id': tab_id}, 'frameId': 0})
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
                    sendMessage: (tabId,message) => call('tabs.sendMessage',{tabId,message})
                },
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
                await route.fulfill(content_type='text/html', body='''<!doctype html><html><body>
                  <main><div class="ha"><h2 class="hP">Planejamento da semana</h2></div>
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
        await expect(gmail.locator('#flow-status')).to_contain_text('Salvo no Flow')
        flow_id = next(i for i, page in adapter.pages.items() if page.url.startswith(FLOW))
        flow = adapter.pages[flow_id]
        db = await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1'))")
        task = next(t for t in db['tasks'] if t['title'] == 'Organizar planejamento')
        assert task['dueDate'] == '2026-12-10'
        assert task['project'] == 'oferta' and task['gmailSubject'] == 'Planejamento da semana'
        assert task['gmailSender'] == 'coordenacao@example.test' and task['gmailUrl'] == GMAIL
        assert len(db['tasks']) == 5
        await expect(flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')).to_be_visible()
        passed('Save writes the chosen project, title, sender and link; Flow updates immediately')
        demand_title = flow.locator('.pipeline-task .text-button').filter(has_text='Organizar planejamento')
        assert await demand_title.get_attribute('data-task') == task['id']
        assert await demand_title.get_attribute('data-open-email') is None
        async with flow.expect_popup() as popup_info:
            await flow.locator('.pipeline-task').filter(has_text='Organizar planejamento').get_by_role('button', name='Abrir Gmail').click()
        email_page = await popup_info.value
        await email_page.wait_for_url(GMAIL)
        await email_page.close()
        passed('The explicit Abrir Gmail button on the pipeline card opens the original conversation')

        await gmail.get_by_role('button', name='Ver no Flow').click()
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

        await flow.reload()
        await expect(flow.locator('.pipeline-task').filter(has_text='Organizar planejamento')).to_be_visible()
        await flow.locator('#sidebar-nav [data-page="projetos"]').click()
        await flow.locator('[data-action="new-project"]').click()
        await flow.locator('#active-modal-form [name="name"]').fill('Minha nova lista')
        await flow.locator('#active-modal-form [type="submit"]').click()
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
        assert await flow.evaluate("JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.length") == 5
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
        await gmail.evaluate("""() => {
          document.querySelector('h2.hP').textContent='Outro assunto <script>literal</script>';
          location.hash='inbox/qrstuvwxyzabcdef';
        }""")
        await expect(button).to_have_count(1)
        await button.click()
        await expect(gmail.locator('#flow-gmail-dialog [name="title"]')).to_have_value('Outro assunto <script>literal</script>')
        await expect(select).to_be_enabled()
        passed('Gmail navigation removes/recreates one button and safely captures the current subject')

        await flow.evaluate("""() => {const db=JSON.parse(localStorage.getItem('flow.workspace.v1'));db.projects=[];localStorage.setItem('flow.workspace.v1',JSON.stringify(db));}""")
        await gmail.locator('#flow-close').click()
        await button.click()
        await expect(gmail.locator('#flow-status')).to_contain_text('Crie uma área no Flow')
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
