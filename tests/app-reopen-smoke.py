"""Tarefa concluída pode ser desmarcada para reabrir na esteira (a lista do projeto é coberta em project-generator-smoke)."""
import asyncio
import os
from datetime import datetime, timezone
from tempfile import TemporaryDirectory

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
TASKS = [
    {'id': 'em-andamento', 'title': 'Revisar contrato', 'project': 'carga', 'status': 'doing', 'dueDate': '2026-10-09'},
    {'id': 'antiga', 'title': 'Concluída antes da mudança', 'project': 'carga', 'status': 'done', 'dueDate': '2026-10-09', 'completedAt': 1},
]


async def run(profile):
    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(profile, executable_path='/usr/bin/chromium', headless=True,
                                                             args=['--no-sandbox'], viewport={'width': 1440, 'height': 1000},
                                                             timezone_id='America/Sao_Paulo')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.clock.install(time=datetime(2026, 10, 9, 15, tzinfo=timezone.utc))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        await page.evaluate("""tasks => {
            window.dispatchEvent(new Event('flow:persist-flush'));
            const db = JSON.parse(localStorage.getItem('flow.workspace.v1'));
            db.tasks = tasks.map(task => ({priority: 'medium', plannedDate: '', plannedTime: '', description: '', subtasks: [], sessions: [], startedAt: null, focusCycles: 0, createdAt: 1, completedAt: null, ...task}));
            localStorage.setItem('flow.workspace.v1', JSON.stringify(db));
        }""", TASKS)
        await page.reload()
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        stored = lambda id: page.evaluate("id => {window.dispatchEvent(new Event('flow:persist-flush'));return JSON.parse(localStorage.getItem('flow.workspace.v1')).tasks.find(t => t.id === id)}", id)
        lane = lambda stage, title: page.locator(f'.pipeline-lane[data-stage="{stage}"] .pipeline-task').filter(has_text=title)

        await lane('doing', 'Revisar contrato').locator('[data-complete-task]').click()
        card = lane('done', 'Revisar contrato')
        box = card.locator('[data-complete-task]')
        await expect(box).to_be_checked()
        await expect(box).to_be_enabled()
        await box.click()
        await expect(lane('doing', 'Revisar contrato')).to_have_count(1)
        await expect(lane('doing', 'Revisar contrato').locator('[data-complete-task]')).not_to_be_checked()
        task = await stored('em-andamento')
        assert task['status'] == 'doing' and task['completedAt'] is None and 'reopenStatus' not in task, task
        print('PASS A task completed by mistake is unchecked and returns to the stage it was in (Em andamento)', flush=True)

        await lane('done', 'Concluída antes da mudança').locator('[data-complete-task]').click()
        await expect(lane('waiting', 'Concluída antes da mudança')).to_have_count(1)
        assert (await stored('antiga'))['status'] == 'waiting'
        print('PASS A task completed before this change reopens in Aguardando, like Reabrir tarefa', flush=True)

        assert not errors, errors
        await context.close()


with TemporaryDirectory(prefix='flow-reopen-') as profile:
    asyncio.run(run(profile))
