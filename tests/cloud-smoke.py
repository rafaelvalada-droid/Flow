"""Real browser UI with mocked Supabase/Google HTTP. No real accounts or secrets.

Checks PKCE, private cache selection, cloud acknowledgments, automatic merges, conflicts,
calendar event semantics and Google token revocation, all under the real Content-Security-Policy
served by server.mjs. SQL policies are validated separately, not by these HTTP mocks.
"""
import asyncio
import copy
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
AUTH = 'https://flow-auth-test.supabase.co'
A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
SESSION = 'flow.auth.session.v1'
LEGACY = {'version': 1, 'projects': [{'id': 'carga', 'name': 'Carga horária docente', 'color': '#123456'}],
          'tasks': [{'id': 'legacy-task', 'title': 'Tarefa antiga do navegador', 'project': 'carga', 'status': 'todo', 'dueDate': '2026-10-15', 'sessions': [], 'subtasks': []}], 'preferences': {}}


class Services:
    def __init__(self):
        self.rows = {}
        self.fail_save = False
        self.delay_save = False
        self.gate = asyncio.Event()
        self.started = asyncio.Event()
        self.oauth_user = A
        self.authorizations = []
        self.exchanges = []
        self.events = {}
        self.calendar_calls = []
        self.revoked = []
        self.conflicts = 0

    def session(self, uid):
        return {'project': AUTH, 'access_token': 'test-access-' + uid, 'refresh_token': 'test-refresh', 'expires_at': 2100000000,
                'user': {'id': uid, 'email': ('a' if uid == A else 'b') + '@example.test'}}

    async def route(self, route):
        req = route.request
        url = urlsplit(req.url)
        async def respond(body, status=200):
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
        if url.path == '/api/auth-config':
            await respond({'configured': True, 'url': AUTH, 'key': 'sb_publishable_test'})
            return
        if url.hostname == 'flow-auth-test.supabase.co':
            if url.path == '/auth/v1/authorize':
                query = parse_qs(url.query)
                assert query['provider'] == ['google'] and query['code_challenge_method'] == ['s256']
                assert len(query['code_challenge'][0]) == 43
                self.authorizations.append(query)
                await route.fulfill(status=302, headers={'location': BASE + '/?code=test-code'})
                return
            if url.path == '/auth/v1/token':
                body = req.post_data_json
                assert parse_qs(url.query)['grant_type'] == ['pkce']
                assert body['auth_code'] == 'test-code' and len(body['code_verifier']) == 43
                self.exchanges.append(body)
                payload = self.session(self.oauth_user)
                payload['provider_token'] = 'test-google-provider-token'
                await respond(payload)
                return
            token = req.headers.get('authorization', '')
            uid = token.removeprefix('Bearer test-access-')
            assert uid in [A, B], 'Requests must carry an authenticated user token'
            if url.path == '/auth/v1/user':
                await respond(self.session(uid)['user'])
            elif url.path == '/auth/v1/logout':
                await respond({})
            elif url.path == '/rest/v1/flow_workspaces':
                assert parse_qs(url.query)['user_id'] == ['eq.' + uid]
                await respond([self.rows[uid]] if uid in self.rows else [])
            elif url.path == '/rest/v1/rpc/flow_save_workspace':
                body = req.post_data_json
                assert set(body) == {'workspace_data', 'expected_revision'}
                self.started.set()
                if self.delay_save:
                    await self.gate.wait()
                if self.fail_save:
                    await respond({'message': 'Simulated service failure'}, 500)
                elif body['expected_revision'] != self.rows.get(uid, {}).get('revision', 0):
                    self.conflicts += 1
                    await respond({'message': 'Workspace revision conflict'}, 409)
                else:
                    revision = body['expected_revision'] + 1
                    self.rows[uid] = {'data': copy.deepcopy(body['workspace_data']), 'revision': revision}
                    await respond({'revision': revision})
            else:
                raise AssertionError('Unexpected Supabase request: ' + req.url)
            return
        if url.hostname == 'oauth2.googleapis.com' and url.path == '/revoke':
            self.revoked.append(parse_qs(req.post_data or '').get('token', [''])[0])
            await route.fulfill(status=200, body='')
            return
        if url.hostname == 'www.googleapis.com':
            assert req.headers['authorization'] == 'Bearer test-google-provider-token'
            prefix = '/calendar/v3/calendars/primary/events'
            assert url.path.startswith(prefix)
            event_id = url.path[len(prefix):].strip('/')
            self.calendar_calls.append((req.method, event_id))
            if req.method == 'GET' and not event_id and 'privateExtendedProperty' in parse_qs(url.query):
                rules = [rule.split('=', 1) for rule in parse_qs(url.query)['privateExtendedProperty']]
                await respond({'items': [event for event in self.events.values() if event.get('status') != 'cancelled'
                    and all(event.get('extendedProperties', {}).get('private', {}).get(key) == value for key, value in rules)]})
            elif req.method == 'GET' and not event_id:
                query = parse_qs(url.query)
                start = query['timeMin'][0][:10]
                await respond({'items': list(self.events.values()) + [
                    {'id':'external','summary':'Reunião do Google <teste>','start':{'date':start},'end':{'date':query['timeMax'][0][:10]}},
                    {'id':'cancelled','status':'cancelled','summary':'Cancelado','start':{'date':start},'end':{'date':query['timeMax'][0][:10]}}]})
            elif req.method == 'POST':
                body = req.post_data_json
                event_id = body['id']
                assert all(c in '0123456789abcdefghijklmnopqrstuv' for c in event_id)
                if event_id in self.events:
                    await respond({'error': 'duplicate'}, 409)
                else:
                    self.events[event_id] = body
                    await respond(body)
            elif event_id not in self.events:
                await respond({'error': 'missing'}, 404)
            elif req.method == 'GET':
                await respond(self.events[event_id])
            elif req.method == 'PUT':
                self.events[event_id] = {**req.post_data_json, 'id': event_id}
                await respond(self.events[event_id])
            elif req.method == 'PATCH':
                self.events[event_id].update(req.post_data_json)
                await respond(self.events[event_id])
            elif req.method == 'DELETE':
                del self.events[event_id]
                await route.fulfill(status=204)
            else:
                raise AssertionError(req.method)
            return
        await route.continue_()


async def until(page, expression, timeout=15):
    """page.wait_for_function compiles strings with eval, which the production CSP blocks; poll with evaluate()."""
    deadline, last = asyncio.get_running_loop().time() + timeout, None
    while True:
        try:
            if await page.evaluate(expression):
                return
        except Exception as error:  # navigation in progress or a not-yet-defined value
            last = error
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f'Timed out waiting for {expression} ({last})')
        await asyncio.sleep(0.05)


async def board(page):
    """Opens Hoje; every demand here has a past day, so all of them show up as overdue."""
    await page.locator('#sidebar-nav [data-page="hoje"]').click()
    await expect(page.locator('.today-layout')).to_be_visible()


def demands(page):
    return page.locator('.today-todo .today-item')


async def capture(page, title):
    await page.locator('.top-actions [data-action="new-task"]').click()
    form = page.locator('#active-modal-form')
    await form.locator('[name="title"]').fill(title)
    await form.locator('[name="project"]').select_option('carga')
    await form.locator('[name="dueDate"]').fill('2026-10-15')
    await form.locator('[type="submit"]').click()


async def main():
    checks = 0
    def passed(text):
        nonlocal checks
        checks += 1
        print('PASS ' + text, flush=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        services = Services()
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, timezone_id='America/Sao_Paulo')
        await context.route('**/*', services.route)
        violations = []
        await context.expose_function('__flowCspViolation', lambda text: violations.append(text))
        await context.add_init_script("document.addEventListener('securitypolicyviolation',e=>window.__flowCspViolation(e.effectiveDirective+' '+e.blockedURI+' '+e.sourceFile+':'+e.lineNumber))")
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: violations.append(message.text) if 'Content Security Policy' in message.text else None)
        boot_requested, boot_release = asyncio.Event(), asyncio.Event()
        async def hold_config(route):
            boot_requested.set()
            await boot_release.wait()
            await services.route(route)
        await page.route('**/api/auth-config', hold_config)
        response = await page.goto(BASE)
        assert "script-src 'self'" in (await response.all_headers()).get('content-security-policy', ''), 'Tests run under the production CSP'
        await boot_requested.wait()
        await expect(page.locator('.app-shell')).to_be_visible()
        await expect(page.locator('.startup-heading h1')).to_have_text('Entrada')
        assert await page.locator('#login-screen').count() == 0
        assert await page.locator('.today-item,.gmail-review-card').count() == 0
        assert await page.locator('.sidebar').evaluate('(el)=>el.inert')
        boot_release.set()
        await expect(page.locator('#google-login')).to_be_visible()
        await page.unroute('**/api/auth-config', hold_config)
        await expect(page.locator('.app-shell')).to_be_visible()
        passed('Entrada opens during initialization; sign-in stays inline and private tasks remain protected')
        await page.evaluate('data=>localStorage.setItem("flow.workspace.v1",JSON.stringify(data))', LEGACY)
        await page.locator('#google-login').click()
        await board(page)
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert len(services.authorizations) == len(services.exchanges) == 1
        assert 'provider_token' not in await page.evaluate('JSON.parse(localStorage.getItem("flow.auth.session.v1"))'), 'A plain sign-in keeps no Google token' 
        assert await demands(page).count() == 0
        assert services.rows[A]['data']['tasks'] == []
        assert await page.evaluate('JSON.parse(localStorage.getItem("flow.workspace.v1")).tasks[0].id') == 'legacy-task'
        passed('Google PKCE sign-in loads a verified account and leaves old browser data separate')

        await page.locator('#account-button').click()
        page.once('dialog', lambda dialog: dialog.accept())
        await page.locator('[data-action="import-local"]').click()
        await expect(demands(page)).to_have_count(1)
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert services.rows[A]['data']['tasks'][0]['id'] == 'legacy-task'
        await page.reload()
        await board(page)
        await expect(demands(page)).to_have_count(1)
        passed('Explicit local import preserves task IDs and survives a cloud reload')

        services.fail_save = True
        await capture(page, 'Alteração com rede indisponível')
        await expect(page.locator('#account-button')).to_have_text('Falha ao salvar')
        assert len(services.rows[A]['data']['tasks']) == 1
        assert await page.evaluate('localStorage.getItem("flow.workspace.v1:'+A+'.pending")') == '1'
        services.fail_save = False
        await page.evaluate('FlowCloud.flush()')
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert len(services.rows[A]['data']['tasks']) == 2
        passed('Network failures retain pending data and show a failed save until a real acknowledgment')

        await page.evaluate("""() => {
            window.chrome={runtime:{id:'test-extension',onMessage:{addListener: fn=>window.bridgeListener=fn}}};
        }""")
        # Content scripts run outside the page CSP; evaluate() injects the bridge the same way.
        await page.evaluate((ROOT / 'extensao-chrome/flow-bridge.js').read_text())
        services.delay_save = True
        services.started.clear()
        capture_data = {'requestId': 'cloud-capture-123456789', 'title': 'Demanda do Gmail na nuvem', 'projectId': 'carga',
                        'dueDate': '2026-10-15', 'gmailUrl': 'https://mail.google.com/mail/u/0/#inbox/abcdefghijklmnop'}
        await page.evaluate("""data=>{
            window.bridgeAnswer=null;
            window.bridgeListener({type:'FLOW_BRIDGE_SAVE',data},{id:'test-extension'},result=>window.bridgeAnswer=result);
        }""", capture_data)
        await services.started.wait()
        assert await page.evaluate('window.bridgeAnswer') is None
        services.gate.set()
        await until(page, 'window.bridgeAnswer?.ok===true')
        services.delay_save = False
        assert len(services.rows[A]['data']['tasks']) == 3
        duplicate = await page.evaluate("""data=>new Promise(resolve=>window.bridgeListener({type:'FLOW_BRIDGE_SAVE',data},{id:'test-extension'},resolve))""", capture_data)
        assert duplicate['ok'] and len(services.rows[A]['data']['tasks']) == 3
        passed('Gmail waits for the cloud response and retries the same capture without duplicates')

        card = demands(page).filter(has_text='Tarefa antiga do navegador')
        await card.locator('.today-open').click()
        await page.locator('#edit-status').select_option('doing')
        # Com ΔT, o dia de execução fica separado do prazo (15/10); sem ΔT, o dia é a própria data da demanda.
        await page.locator('#edit-duration').select_option('30')
        await page.locator('#edit-planned').fill('2026-10-13')
        await page.locator('#edit-planned').dispatch_event('change')
        await page.locator('[data-action="detail-back"]').click()
        await expect(card).to_contain_text('Em andamento')
        await expect(card.locator('.today-time')).to_have_text('08:00–08:30')
        await page.evaluate('FlowCloud.flush()')
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('[data-action="calendar-connect"]').click()
        await board(page)
        await until(page, 'FlowCalendar.info().status==="synced"')
        assert 'calendar.events' in services.authorizations[-1]['scopes'][0]
        assert len(services.events) == 1
        event = next(iter(services.events.values()))
        assert event['start']['dateTime'] == '2026-10-13T11:00:00.000Z'
        assert event['end']['dateTime'] == '2026-10-13T11:30:00.000Z'
        assert '2026-10-15' in event['description'] and event['visibility'] == 'private'
        passed('Dia and ΔT reserve the first free time of the day; Google Agenda gets that block and keeps the deadline separate')
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await until(page, '!FlowCalendar.info().reading && FlowCalendar.info().events.length===1')
        await expect(page.locator('.google-calendar-event')).to_have_count(7)
        await expect(page.locator('.google-calendar-event').first).to_contain_text('Reunião do Google <teste>')
        assert await page.locator('.google-calendar-event teste').count() == 0
        await page.locator('[data-action="week-next"]').click()
        await until(page, '!FlowCalendar.info().reading && FlowCalendar.info().events.length===1')
        await expect(page.locator('.google-calendar-event')).to_have_count(7)
        passed('Google appointments load for the visible week, span days, escape titles and exclude cancelled/duplicate Flow events')
        await board(page)


        await demands(page).filter(has_text='Tarefa antiga do navegador').locator('.today-open').click()
        await page.locator('#edit-planned').fill('2026-10-14')
        await page.locator('#edit-planned').dispatch_event('change')
        await page.evaluate('FlowCalendar.synchronize()')
        assert len(services.events) == 1
        event = next(iter(services.events.values()))
        assert event['start']['dateTime'] == '2026-10-14T11:00:00.000Z' and event['end']['dateTime'] == '2026-10-14T11:30:00.000Z'
        await page.locator('#edit-duration').select_option('')
        await page.evaluate('FlowCalendar.synchronize()')
        assert len(services.events) == 0
        assert await page.evaluate('JSON.parse(localStorage.getItem("flow.workspace.v1:'+A+'")).tasks.find(t=>t.id==="legacy-task").dueDate') == '2026-10-14'
        passed('Moving the day moves the one reserved event; removing the ΔT removes only the Flow-owned event and keeps the day')

        # The phone add-on writes a task directly in Supabase and bumps the revision.
        await page.evaluate('FlowCloud.flush()')
        phone = copy.deepcopy(services.rows[A]['data']['tasks'][0])
        phone.update({'id': 'phone-capture', 'title': 'Captura do celular', 'gmailCaptureId': 'gmail-mobile-abcdef12'})
        services.rows[A]['data']['tasks'].insert(0, phone)
        services.rows[A]['revision'] += 1
        await board(page)
        await capture(page, 'Alteração local durante a captura')
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        titles = [task['title'] for task in services.rows[A]['data']['tasks']]
        assert 'Captura do celular' in titles and 'Alteração local durante a captura' in titles, titles
        await expect(demands(page).filter(has_text='Captura do celular')).to_be_visible()
        assert await page.evaluate('JSON.parse(localStorage.getItem("flow.workspace.v1:'+A+'")).tasks.some(t=>t.id==="phone-capture")')
        passed('A 409 from a phone capture merges automatically, saves once and shows both demands without a conflict')

        other = await context.new_page()
        other.on('pageerror', lambda error: errors.append(str(error)))
        await other.goto(BASE)
        await expect(other.locator('#account-button')).to_have_text('Salvo na nuvem')
        await board(page)
        await capture(page, 'Salva na primeira aba')
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        saved_revision, conflicts = services.rows[A]['revision'], services.conflicts
        await board(other)
        await expect(demands(other).filter(has_text='Salva na primeira aba')).to_be_visible()
        await capture(other, 'Salva na segunda aba')
        await expect(other.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert services.rows[A]['revision'] == saved_revision + 1 and services.conflicts == conflicts, 'No 409 round trip'
        titles = [task['title'] for task in services.rows[A]['data']['tasks']]
        assert 'Salva na primeira aba' in titles and 'Salva na segunda aba' in titles, titles
        await other.close()
        await expect(demands(page).filter(has_text='Salva na segunda aba')).to_be_visible()
        passed('A second tab adopts the revision saved by the first and saves without a conflict')

        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('.calendar-compact-row summary').click()
        await page.locator('[data-action="calendar-disconnect"]').click()
        await until(page, '!JSON.parse(localStorage.getItem("flow.auth.session.v1")).provider_token')
        await until(page, 'FlowCloud.calendarToken()===null')
        assert services.revoked == ['test-google-provider-token'], services.revoked
        passed('Disconnecting the last Google integration deletes the token from the browser and revokes it at Google')

        # The same task changes on another device and here: a real conflict must not be merged.
        await page.evaluate('FlowCloud.flush()')
        services.rows[A]['revision'] += 1
        remote_tasks = services.rows[A]['data']['tasks']
        legacy = next(task for task in remote_tasks if task['id'] == 'legacy-task')
        legacy['title'] = 'Título alterado no celular'
        await board(page)
        await demands(page).filter(has_text='Tarefa antiga do navegador').locator('.today-open').click()
        await page.locator('#edit-title').fill('Título alterado no computador')
        await page.locator('#edit-title').dispatch_event('change')
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        assert legacy['title'] == 'Título alterado no celular' and len(services.rows[A]['data']['tasks']) == len(remote_tasks)
        await page.reload()
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        await page.reload()
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        assert legacy['title'] == 'Título alterado no celular'
        passed('Concurrent edits of the same field produce a visible conflict without overwriting the other device')

        await page.locator('#account-button').click()
        await page.locator('[data-action="sign-out"]').click()
        await expect(page.locator('#google-login')).to_be_visible()
        services.oauth_user = B
        await page.locator('#google-login').click()
        await board(page)
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert await demands(page).count() == 0
        assert services.rows[B]['data']['tasks'] == []
        assert await page.evaluate('localStorage.getItem("flow.workspace.v1:'+A+'.pending")') == '1'
        assert not errors, errors
        passed('Signing into another Google account shows an empty private workspace and preserves first-account pending data')
        assert not violations, violations
        passed('No Content-Security-Policy violations during sign-in, sync, Gmail bridge, Agenda and conflicts')
        await context.close()
        await browser.close()
    print(f'{checks} mocked-service browser checks passed.', flush=True)


asyncio.run(main())
