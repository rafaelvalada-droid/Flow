"""Cloud-mode browser checks for local imports, merged cloud versions and a full browser storage.

Supabase HTTP is mocked; no real account, token or service is used.
"""
import asyncio
import copy
import json
import os
import time
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
AUTH = 'https://flow-app-data-test.supabase.co'
USER = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
SESSION = 'flow.auth.session.v1'
KEY = 'flow.workspace.v1:' + USER
NOW = int(time.time() * 1000)


def task(id, title, project='carga', **extra):
    return {'id': id, 'title': title, 'project': project, 'status': 'todo', 'priority': 'medium', 'dueDate': '2026-10-20',
            'plannedDate': '', 'plannedTime': '', 'description': '', 'subtasks': [], 'sessions': [], 'startedAt': None,
            'createdAt': extra.pop('createdAt', 1), 'completedAt': None, **extra}


AREA = {'id': 'carga', 'name': 'Carga horária docente', 'color': '#9270d4'}
LEGACY = {'version': 1, 'classificationCatalogVersion': 5, 'projects': [AREA],
          'archivedProjects': [{'id': 'antiga', 'name': 'Área antiga arquivada', 'color': '#507ee9'}],
          'initiatives': [{'id': 'p1', 'name': 'Projeto do navegador', 'areaId': 'carga', 'createdAt': 10}],
          'tasks': [task('local-linked', 'Tarefa do projeto local', initiativeId='p1', createdAt=2),
                    task('local-ghost', 'Tarefa de projeto ausente', initiativeId='ghost', createdAt=3),
                    task('local-archived', 'Tarefa da área arquivada', project='antiga', createdAt=4),
                    task('local-trashed', 'Tarefa do projeto excluído', initiativeId=None, createdAt=5)],
          'projectTrash': [{'project': {'id': 'p-old', 'name': 'Projeto na lixeira', 'areaId': 'carga'}, 'deletedAt': NOW,
                            'expiresAt': NOW + 10 * 86400000, 'taskIds': ['local-trashed']}],
          'preferences': {}}
REMOTE = {'version': 1, 'classificationCatalogVersion': 5, 'projects': [AREA],
          'initiatives': [{'id': 'p1', 'name': 'Projeto da nuvem', 'areaId': 'carga', 'createdAt': 20}],
          'tasks': [task('cloud-task', 'Tarefa da nuvem', createdAt=6)], 'preferences': {}}


async def main():
    row = {'data': copy.deepcopy(REMOTE), 'revision': 1}
    saves = []
    session = {'project': AUTH, 'user': {'id': USER, 'email': 'dados@example.test'}, 'access_token': 'test-access-token-long-enough',
               'refresh_token': 'test-refresh', 'expires_at': 2100000000}

    async def route(r):
        req = r.request
        url = urlsplit(req.url)
        async def reply(data, status=200):
            await r.fulfill(status=status, content_type='application/json', body=json.dumps(data))
        if url.path == '/api/auth-config':
            return await reply({'configured': True, 'url': AUTH, 'key': 'sb_publishable_test'})
        if url.hostname == urlsplit(AUTH).hostname:
            assert req.headers.get('authorization') == 'Bearer ' + session['access_token']
            if url.path == '/auth/v1/user':
                return await reply(session['user'])
            if url.path == '/rest/v1/flow_workspaces':
                assert parse_qs(url.query)['user_id'] == ['eq.' + USER]
                return await reply([row])
            if url.path == '/rest/v1/rpc/flow_save_workspace':
                body = req.post_data_json
                if body['expected_revision'] != row['revision']:
                    return await reply({'message': 'Workspace revision conflict'}, 409)
                row['data'] = body['workspace_data']; row['revision'] += 1; saves.append(body['workspace_data'])
                return await reply({'revision': row['revision']})
            raise AssertionError('Unexpected Supabase request ' + url.path)
        await r.continue_()

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = await browser.new_context(timezone_id='America/Sao_Paulo')
        await context.add_init_script(f"""if(!localStorage.getItem({json.dumps(SESSION)})){{
          localStorage.setItem({json.dumps(SESSION)},{json.dumps(json.dumps(session))});
          localStorage.setItem('flow.workspace.v1',{json.dumps(json.dumps(LEGACY))});}}""")
        await context.route('**/*', route)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: asyncio.ensure_future(dialog.accept()))
        await page.goto(BASE)
        await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy', 'true')
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')

        async def cached():
            return json.loads(await page.evaluate("(key)=>{window.dispatchEvent(new Event('flow:persist-flush'));return localStorage.getItem(key)}", KEY))

        for attempt in range(2):
            await page.locator('#account-button').click()
            await page.locator('[data-action="import-local"]').click()
            await expect(page.locator('#toast')).to_have_text(f'{4 if attempt == 0 else 0} tarefas acrescentadas. Cronômetros importados ficam pausados.')
        db = await cached()
        assert [a['id'] for a in db['projects']] == ['carga'] and [a['id'] for a in db['archivedProjects']] == ['antiga']
        names = {p['name']: p['id'] for p in db['initiatives']}
        assert len(db['initiatives']) == 2 and names['Projeto da nuvem'] == 'p1' and names['Projeto do navegador'] != 'p1'
        tasks = {t['id']: t for t in db['tasks']}
        assert len(tasks) == 5
        assert tasks['local-linked']['initiativeId'] == names['Projeto do navegador']
        assert tasks['local-ghost']['initiativeId'] is None and tasks['local-archived']['project'] == 'antiga'
        trash = [entry for entry in db['projectTrash'] if entry['project']['name'] == 'Projeto na lixeira']
        assert len(trash) == 1 and trash[0]['taskIds'] == ['local-trashed']
        await page.locator('#sidebar-nav [data-page="meus-projetos"]').click()
        await page.locator('.project-trash summary').click()
        await page.locator('[data-action="restore-initiative"]').click()
        assert next(t for t in (await cached())['tasks'] if t['id'] == 'local-trashed')['initiativeId'] == 'p-old'
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert any(t['id'] == 'local-linked' for t in row['data']['tasks'])
        print('PASS Browser import keeps archived areas archived, remaps project IDs, frees orphan links, restores trash and is idempotent', flush=True)

        merged = copy.deepcopy(row['data'])
        merged['tasks'].insert(0, task('merged-task', 'Tarefa mesclada da nuvem', createdAt=7))
        count = len(saves)
        await page.evaluate("(data)=>window.dispatchEvent(new CustomEvent('flow:cloud-remote-merged',{detail:{data}}))", merged)
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-date-filter').select_option('all')
        await expect(page.locator('.pipeline-task').filter(has_text='Tarefa mesclada da nuvem')).to_be_visible()
        assert any(t['id'] == 'merged-task' for t in json.loads(await page.evaluate('(key)=>localStorage.getItem(key)', KEY))['tasks'])
        await page.wait_for_timeout(1500)
        assert len(saves) == count, 'A merged version is cached locally without being uploaded again'
        demand = page.locator('.pipeline-task').filter(has_text='Tarefa da nuvem')
        await demand.locator('summary').click()
        await demand.locator('[data-action="task-detail"]').click()
        await page.locator('#edit-description').click()
        await page.keyboard.type('Anotação em andamento', delay=5)
        merged['tasks'].insert(0, task('merged-second', 'Segunda tarefa mesclada', createdAt=8))
        await page.evaluate("(data)=>window.dispatchEvent(new CustomEvent('flow:cloud-remote-merged',{detail:{data}}))", merged)
        assert await page.evaluate('document.activeElement.id') == 'edit-description'
        await expect(page.locator('#edit-description')).to_have_value('Anotação em andamento')
        await page.keyboard.type(' continuada', delay=5)
        db = await cached()
        assert any(t['id'] == 'merged-second' for t in db['tasks'])
        assert next(t for t in db['tasks'] if t['id'] == 'cloud-task')['description'] == 'Anotação em andamento continuada'
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        assert next(t for t in row['data']['tasks'] if t['id'] == 'cloud-task')['description'] == 'Anotação em andamento continuada'
        print('PASS A merged cloud version replaces the workspace, keeps the text being typed and is not re-uploaded by itself', flush=True)

        await page.evaluate("""(key)=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){
          if(name===key)throw new DOMException('Cota excedida','QuotaExceededError');return set.call(this,name,value)}}""", KEY)
        await page.locator('#sidebar-nav [data-page="alertas"]').click()
        await page.locator('[data-alert="3"]').click()
        await expect(page.locator('#toast')).to_contain_text('as alterações continuam sendo enviadas para a nuvem')
        await expect(page.locator('#account-button')).to_have_text('Salvo na nuvem')
        for _ in range(40):
            if row['data']['preferences']['alerts'][3] is True:
                break
            await asyncio.sleep(.1)
        assert row['data']['preferences']['alerts'][3] is True
        print('PASS A full browser storage still uploads the change and explains it in Portuguese', flush=True)
        assert not errors, errors
        print('PASS No uncaught JavaScript errors', flush=True)
        await browser.close()
    print('4 app cloud-data browser checks passed.', flush=True)


asyncio.run(main())
