"""Dois aparelhos na mesma conta: o app aberto recebe o que outro aparelho salvou, sem recarregar.

Supabase HTTP é simulado; nenhuma conta, token ou serviço real é usado.
"""
import asyncio
import copy
import json
import os
import time
from datetime import date, timedelta
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
AUTH = 'https://flow-device-sync-test.supabase.co'
USER = 'dddddddd-dddd-4ddd-dddd-dddddddddddd'
SESSION = 'flow.auth.session.v1'
AREA = {'id': 'carga', 'name': 'Carga horária docente', 'color': '#9270d4'}


def task(id, title, **extra):
    return {'id': id, 'title': title, 'project': 'carga', 'status': 'todo', 'priority': 'medium', 'dueDate': (date.today() - timedelta(days=1)).isoformat(),
            'plannedDate': '', 'plannedTime': '', 'description': '', 'subtasks': [], 'sessions': [], 'startedAt': None,
            'focusCycles': 0, 'createdAt': 1, 'completedAt': None, **extra}


REMOTE = {'version': 1, 'classificationCatalogVersion': 5, 'projects': [AREA], 'initiatives': [], 'preferences': {},
          'tasks': [task('a', 'Responder coordenação'), task('b', 'Enviar planilha')]}


async def main():
    row = {'data': copy.deepcopy(REMOTE), 'revision': 1}
    saves, revision_checks = [], []
    session = {'project': AUTH, 'user': {'id': USER, 'email': 'aparelhos@example.test'}, 'access_token': 'test-access-token-long-enough',
               'refresh_token': 'test-refresh', 'expires_at': 2100000000}

    async def route(r):
        req = r.request
        url = urlsplit(req.url)

        async def reply(data, status=200):
            await r.fulfill(status=status, content_type='application/json', body=json.dumps(data))
        if url.path == '/api/auth-config':
            return await reply({'configured': True, 'url': AUTH, 'key': 'sb_publishable_test'})
        if url.hostname == urlsplit(AUTH).hostname:
            if url.path == '/auth/v1/user':
                return await reply(session['user'])
            if url.path == '/rest/v1/flow_workspaces':
                query = parse_qs(url.query)
                assert query['user_id'] == ['eq.' + USER]
                if query['select'] == ['revision']:
                    revision_checks.append(row['revision'])
                    return await reply([{'revision': row['revision']}])
                return await reply([copy.deepcopy(row)])
            if url.path == '/rest/v1/rpc/flow_save_workspace':
                body = req.post_data_json
                if body['expected_revision'] != row['revision']:
                    return await reply({'message': 'Workspace revision conflict'}, 409)
                row['data'] = body['workspace_data']
                row['revision'] += 1
                saves.append(body['workspace_data'])
                return await reply({'revision': row['revision']})
            raise AssertionError('Unexpected Supabase request ' + url.path)
        await r.continue_()

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = await browser.new_context(timezone_id='America/Sao_Paulo')
        await context.add_init_script(f"if(!localStorage.getItem({json.dumps(SESSION)}))localStorage.setItem({json.dumps(SESSION)},{json.dumps(json.dumps(session))});")
        await context.route('**/*', route)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.clock.install(time=time.time())
        await page.goto(BASE)
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        lane = lambda stage: page.locator(f'.today-{stage} .today-item')
        await expect(lane('done')).to_have_count(0)
        # A abertura completa campos padrão do workspace e salva uma vez; a contagem começa depois disso.
        await page.clock.fast_forward(1000)
        await expect(page.locator('.sidebar-foot')).to_contain_text('Google')
        for _ in range(50):
            if await page.evaluate("FlowCloud.info().status") == 'saved':
                break
            await asyncio.sleep(0.1)
        saves.clear()

        # Outro aparelho (computador) conclui "Responder coordenação" e salva na nuvem.
        other = copy.deepcopy(row['data'])
        next(t for t in other['tasks'] if t['id'] == 'a').update(status='done', completedAt=int(time.time() * 1000))
        row.update(data=other, revision=row['revision'] + 1)
        await page.clock.fast_forward(61000)
        await expect(lane('done').filter(has_text='Responder coordenação')).to_have_count(1)
        assert saves == [], 'Receiving another device copy must not upload anything'
        stored = await page.evaluate("key => JSON.parse(localStorage.getItem(key))", 'flow.workspace.v1:' + USER)
        assert next(t for t in stored['tasks'] if t['id'] == 'a')['status'] == 'done'
        print('PASS An open app shows a task completed on another device within a minute, without reloading or uploading', flush=True)

        # Concluir aqui enquanto o celular inclui uma tarefa na nuvem: o envio recebe 409, junta e as duas mudanças ficam.
        await lane('todo').filter(has_text='Enviar planilha').locator('[data-complete-task]').click()
        phone = copy.deepcopy(row['data'])
        phone['tasks'].insert(0, task('c', 'Capturada no celular'))
        row.update(data=phone, revision=row['revision'] + 1)
        await page.clock.fast_forward(1000)
        await expect(lane('todo').filter(has_text='Capturada no celular')).to_have_count(1)
        await expect(lane('done').filter(has_text='Enviar planilha')).to_have_count(1)
        for _ in range(100):
            if any(t['id'] == 'c' for t in (saves[-1]['tasks'] if saves else [])):
                break
            await asyncio.sleep(0.1)
        statuses = {t['id']: t['status'] for t in row['data']['tasks']}
        assert statuses == {'c': 'todo', 'a': 'done', 'b': 'done'}, statuses
        print('PASS A local completion and a capture saved meanwhile by the phone are merged and both reach the cloud', flush=True)

        # Ao voltar para o app (foco), a verificação é imediata, sem esperar o minuto.
        later = copy.deepcopy(row['data'])
        later['tasks'].insert(0, task('d', 'Incluída no computador'))
        row.update(data=later, revision=row['revision'] + 1)
        uploads = len(saves)
        await page.clock.fast_forward(16000)
        await page.evaluate("window.dispatchEvent(new Event('focus'))")
        await expect(lane('todo').filter(has_text='Incluída no computador')).to_have_count(1)
        assert len(saves) == uploads
        print('PASS Returning to the app checks the cloud at once and shows what another device added', flush=True)
        assert revision_checks, 'Only the revision is checked before downloading the workspace'
        assert not errors, errors
        await browser.close()


asyncio.run(main())
