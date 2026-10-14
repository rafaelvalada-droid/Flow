"""Esteira: o filtro padrão "Hoje e atrasadas" junta o que vence hoje com o que venceu e segue aberto."""
import asyncio
import os
from datetime import datetime, timezone
from tempfile import TemporaryDirectory

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
TASKS = [
    {'id': 'hoje', 'title': 'Vence hoje', 'project': 'carga', 'status': 'todo', 'dueDate': '2026-10-09'},
    {'id': 'hoje-feita', 'title': 'Concluída hoje', 'project': 'carga', 'status': 'done', 'dueDate': '2026-10-09', 'completedAt': 1},
    {'id': 'atrasada', 'title': 'Atrasada aberta', 'project': 'oferta', 'status': 'doing', 'dueDate': '2026-10-02'},
    {'id': 'atrasada-feita', 'title': 'Atrasada já concluída', 'project': 'oferta', 'status': 'done', 'dueDate': '2026-10-01', 'completedAt': 1},
    {'id': 'amanha', 'title': 'Vence amanhã', 'project': 'cpa', 'status': 'todo', 'dueDate': '2026-10-10'},
    {'id': 'sem-prazo', 'title': 'Sem prazo', 'project': 'cpa', 'status': 'todo', 'dueDate': ''},
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
        board = page.locator('#board-date-filter')
        await expect(board).to_have_value('today')
        options = await board.locator('option').evaluate_all('options => options.map(o => [o.value, o.textContent])')
        assert options == [['today', 'Hoje e atrasadas'], ['all', 'Todas as datas'], ['tomorrow', 'Amanhã'], ['specific', 'Escolher data']], options
        print('PASS The deadline filter offers "Hoje e atrasadas" as the default and no separate Hoje/Atrasadas options', flush=True)

        visible = page.locator('.pipeline-task')
        await expect(visible).to_have_count(3)
        for title in ('Vence hoje', 'Concluída hoje', 'Atrasada aberta'):
            await expect(visible.filter(has_text=title)).to_have_count(1)
        for title in ('Atrasada já concluída', 'Vence amanhã', 'Sem prazo'):
            await expect(visible.filter(has_text=title)).to_have_count(0)
        print('PASS Hoje e atrasadas shows tasks due today (open or done) and overdue open tasks, hiding finished overdue ones', flush=True)

        await board.select_option('tomorrow')
        await expect(visible).to_have_count(1)
        await expect(visible.filter(has_text='Vence amanhã')).to_have_count(1)
        await board.select_option('all')
        await expect(visible).to_have_count(len(TASKS))
        print('PASS Amanhã and Todas as datas keep working', flush=True)
        assert not errors, errors
        await context.close()


with TemporaryDirectory(prefix='flow-board-filter-') as profile:
    asyncio.run(run(profile))
