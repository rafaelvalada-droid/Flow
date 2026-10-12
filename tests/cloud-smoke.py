"""Real browser UI with mocked Supabase/Google HTTP. No real accounts or secrets.

Checks PKCE, private cache selection, cloud acknowledgments, conflicts and calendar
event semantics. SQL policies are validated separately, not by these HTTP mocks.
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
                    await respond({'message': 'Workspace revision conflict'}, 409)
                else:
                    revision = body['expected_revision'] + 1
                    self.rows[uid] = {'data': copy.deepcopy(body['workspace_data']), 'revision': revision}
                    await respond({'revision': revision})
            else:
                raise AssertionError('Unexpected Supabase request: ' + req.url)
            return
        if url.hostname == 'www.googleapis.com':
            assert req.headers['authorization'] == 'Bearer test-google-provider-token'
            prefix = '/calendar/v3/calendars/primary/events'
            assert url.path.startswith(prefix)
            event_id = url.path[len(prefix):].strip('/')
            self.calendar_calls.append((req.method, event_id))
            if req.method == 'GET' and not event_id:
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
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE)
        await expect(page.locator('#google-login')).to_be_visible()
        await expect(page.locator('.app-shell')).to_be_hidden()
        await page.evaluate('data=>localStorage.setItem("flow.workspace.v1",JSON.stringify(data))', LEGACY)
        await page.locator('#google-login').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert len(services.authorizations) == len(services.exchanges) == 1
        assert await page.locator('.pipeline-task').count() == 0
        assert services.rows[A]['data']['tasks'] == []
        assert await page.evaluate('JSON.parse(localStorage.getItem("flow.workspace.v1")).tasks[0].id') == 'legacy-task'
        passed('Google PKCE sign-in loads a verified account and leaves old browser data separate')

        await page.locator('#account-button').click()
        page.once('dialog', lambda dialog: dialog.accept())
        await page.locator('[data-action="import-local"]').click()
        await expect(page.locator('.pipeline-task')).to_have_count(1)
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert services.rows[A]['data']['tasks'][0]['id'] == 'legacy-task'
        await page.reload()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-task')).to_have_count(1)
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
        await page.add_script_tag(content=(ROOT / 'extensao-chrome/flow-bridge.js').read_text())
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
        await page.wait_for_function('window.bridgeAnswer?.ok===true')
        services.delay_save = False
        assert len(services.rows[A]['data']['tasks']) == 3
        duplicate = await page.evaluate("""data=>new Promise(resolve=>window.bridgeListener({type:'FLOW_BRIDGE_SAVE',data},{id:'test-extension'},resolve))""", capture_data)
        assert duplicate['ok'] and len(services.rows[A]['data']['tasks']) == 3
        passed('Gmail waits for the cloud response and retries the same capture without duplicates')

        card = page.locator('.pipeline-task').filter(has_text='Tarefa antiga do navegador')
        await card.locator('summary').click()
        await card.locator('[data-action="advance-task"]').click()
        await expect(page.locator('.pipeline-lane[data-stage="doing"] .pipeline-task').filter(has_text='Tarefa antiga do navegador')).to_be_visible()
        await card.locator('[data-task]').first.click()
        await page.locator('#edit-planned').fill('2026-10-13')
        await page.locator('#edit-planned').dispatch_event('change')
        await page.locator('#edit-time').fill('09:00')
        await page.locator('#edit-time').dispatch_event('change')
        await page.evaluate('FlowCloud.flush()')
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('[data-action="calendar-connect"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        await page.wait_for_function('FlowCalendar.info().status==="synced"')
        assert 'calendar.events' in services.authorizations[-1]['scopes'][0]
        assert len(services.events) == 1
        event = next(iter(services.events.values()))
        assert event['start']['dateTime'] == '2026-10-13T12:00:00.000Z'
        assert event['end']['dateTime'] == '2026-10-13T12:25:00.000Z'
        assert '2026-10-15' in event['description'] and event['visibility'] == 'private'
        passed('Rightward advance works; Google Agenda uses execution time and keeps the deadline separate')
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.wait_for_function('!FlowCalendar.info().reading && FlowCalendar.info().events.length===1')
        await expect(page.locator('.google-calendar-event')).to_have_count(7)
        await expect(page.locator('.google-calendar-event').first).to_contain_text('Reunião do Google <teste>')
        assert await page.locator('.google-calendar-event teste').count() == 0
        await page.locator('[data-action="week-next"]').click()
        await page.wait_for_function('!FlowCalendar.info().reading && FlowCalendar.info().events.length===1')
        await expect(page.locator('.google-calendar-event')).to_have_count(7)
        passed('Google appointments load for the visible week, span days, escape titles and exclude cancelled/duplicate Flow events')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()


        await page.locator('.pipeline-task').filter(has_text='Tarefa antiga do navegador').locator('summary').click()
        await page.locator('.pipeline-task').filter(has_text='Tarefa antiga do navegador').locator('[data-task]').first.click()
        await page.locator('#edit-planned').fill('2026-10-14')
        await page.locator('#edit-planned').dispatch_event('change')
        await page.locator('#edit-time').fill('')
        await page.locator('#edit-time').dispatch_event('change')
        await page.evaluate('FlowCalendar.synchronize()')
        assert len(services.events) == 1
        event = next(iter(services.events.values()))
        assert event['start'] == {'date': '2026-10-14'} and event['end'] == {'date': '2026-10-15'}
        await page.locator('#edit-planned').fill('')
        await page.locator('#edit-planned').dispatch_event('change')
        await page.evaluate('FlowCalendar.synchronize()')
        assert len(services.events) == 0
        passed('Calendar edits update one event; clearing the execution date removes only the Flow-owned event')

        # The remote revision advances elsewhere. Local changes must not overwrite it.
        await page.evaluate('FlowCloud.flush()')
        services.rows[A]['revision'] += 1
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await capture(page, 'Alteração em conflito')
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        assert len(services.rows[A]['data']['tasks']) == 3
        await page.reload()
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        await page.reload()
        await expect(page.locator('#account-button')).to_have_text('Conflito de alterações')
        assert len(services.rows[A]['data']['tasks']) == 3
        passed('Concurrent updates produce a visible conflict without overwriting the other device')

        await page.locator('#account-button').click()
        await page.locator('[data-action="sign-out"]').click()
        await expect(page.locator('#google-login')).to_be_visible()
        services.oauth_user = B
        await page.locator('#google-login').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert await page.locator('.pipeline-task').count() == 0
        assert services.rows[B]['data']['tasks'] == []
        assert await page.evaluate('localStorage.getItem("flow.workspace.v1:'+A+'.pending")') == '1'
        assert not errors, errors
        passed('Signing into another Google account shows an empty private workspace and preserves first-account pending data')
        await context.close()
        await browser.close()
    print(f'{checks} mocked-service browser checks passed.', flush=True)


asyncio.run(main())
