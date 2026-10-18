"""Aba Hoje (no lugar da esteira): lista de hoje e atrasadas, filtros, concluídas, linha do tempo com arraste e ΔT,
teclado, compromissos do Google, Dia e ΔT com horário livre, Próximos e lembretes sem data da Entrada.
O relógio do navegador é fixo em sexta, 9/10/2026, 12:00 (America/Sao_Paulo); a nuvem é simulada."""
import asyncio
import json
import os
from datetime import datetime, timezone
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
TODAY, YESTERDAY, TOMORROW, WEDNESDAY = '2026-10-09', '2026-10-08', '2026-10-10', '2026-10-14'
DONE_AT = int(datetime(2026, 10, 9, 14, tzinfo=timezone.utc).timestamp() * 1000)


def task(id, title, **extra):
    return {'id': id, 'title': title, 'project': 'oferta', 'status': 'todo', 'priority': 'medium', 'plannedDate': '', 'plannedTime': '',
            'dueDate': '', 'duration': None, 'description': '', 'subtasks': [], 'sessions': [], 'startedAt': None, 'focusCycles': 0,
            'gmailUrl': '', 'gmailSubject': '', 'gmailSender': '', 'createdAt': 1, 'completedAt': None, 'initiativeId': None, **extra}


TASKS = [
    task('ouv', 'Atualizar a ouvidoria', plannedDate=TODAY, dueDate=TODAY, plannedTime='09:00', duration=30),
    task('rel', 'Relatório de matrículas', plannedDate=TODAY, dueDate=TODAY, plannedTime='10:00', duration=90),
    task('late', 'Responder coordenação', plannedDate=YESTERDAY, dueDate=YESTERDAY, plannedTime='11:00', duration=60),
    task('rh', 'Ligar para o RH', dueDate=TODAY),
    task('next', 'Revisar contratos', plannedDate=TOMORROW, dueDate=TOMORROW, plannedTime='08:00', duration=45),
    task('wed', 'Planejar semestre', dueDate=WEDNESDAY),
    task('idea', 'Ideia: newsletter'),
    task('sent', 'Enviar ata', status='done', dueDate=TODAY, completedAt=DONE_AT),
]
DATA = {'version': 1, 'areaCatalogVersion': 5, 'projects': [{'id': 'oferta', 'name': 'Oferta de turmas', 'color': '#507ee9'}], 'tasks': TASKS, 'preferences': {}}
FAKE_CLOUD = ("window.FlowCloud={initialize:async()=>({mode:'cloud',key:'test-workspace',data:%s}),info:()=>({mode:'cloud',user:{id:'u',email:'user@ulbra.br'},status:'saved'}),"
              "queue:()=>{},flush:async()=>{},calendarToken:()=>null,gmailToken:()=>null,signIn:async()=>{}};") % json.dumps(DATA)
GOOGLE = "FlowCalendar.info=()=>({connected:true,events:[{summary:'Reunião <CPA>',start:{dateTime:'2026-10-09T16:00:00Z'},end:{dateTime:'2026-10-09T17:00:00Z'}}]})"


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='America/Sao_Paulo')

        async def route(req):
            if req.request.url.endswith('/cloud.js') or '/cloud.js?' in req.request.url:
                await req.fulfill(content_type='text/javascript', body=FAKE_CLOUD)
            else:
                await req.continue_()
        await context.route('**/*', route)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.clock.install(time=datetime(2026, 10, 9, 15, tzinfo=timezone.utc))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')

        async def stored(id):
            return await page.evaluate("id=>{window.dispatchEvent(new Event('flow:persist-flush'));return JSON.parse(localStorage.getItem('test-workspace')).tasks.find(t=>t.id===id)}", id)

        todo = page.locator('.today-todo .today-list .today-item')
        done = page.locator('.today-done .today-item')
        block = lambda id: page.locator(f'[data-block="{id}"]')

        await expect(page.locator('#today-count')).to_have_text('4')
        await expect(page.locator('#inbox-count')).to_have_text('1')
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(page.locator('.today-tabs [role="tab"]')).to_have_text(['Hoje 4', 'Próximos 2'])
        await expect(page.locator('[data-action="today-filter"]')).to_have_text(['Hoje e atrasadas 4', 'Só hoje 3', 'Só atrasadas 1'])
        await expect(todo.locator('strong')).to_have_text(['Atualizar a ouvidoria', 'Relatório de matrículas', 'Responder coordenação', 'Ligar para o RH'])
        await expect(todo.locator('.today-time')).to_have_text(['09:00–09:30', '10:00–11:30', '11:00–12:00', 'Sem horário'])
        await expect(todo.filter(has_text='Responder coordenação')).to_have_class('today-item is-late ')
        await expect(todo.filter(has_text='Responder coordenação')).to_contain_text('Atrasada · qui, 08/10')
        await expect(page.locator('.today-todo')).to_contain_text('3h reservados')
        await expect(done.locator('strong')).to_have_text(['Enviar ata'])
        print('PASS Hoje lists today and overdue demands as one list ordered by time, with Concluídas hoje beside it', flush=True)

        await page.locator('[data-action="today-filter"][data-filter="today"]').click()
        await expect(todo).to_have_count(3)
        await page.locator('[data-action="today-filter"][data-filter="late"]').click()
        await expect(todo.locator('strong')).to_have_text(['Responder coordenação'])
        await page.locator('[data-action="today-filter"][data-filter="both"]').click()
        await expect(todo).to_have_count(4)
        print('PASS Só hoje and Só atrasadas narrow the list; both together is the default', flush=True)

        await todo.filter(has_text='Ligar para o RH').locator('[data-complete-task]').click()
        await expect(done.locator('strong')).to_have_text(['Ligar para o RH', 'Enviar ata'])
        await expect(todo).to_have_count(3)
        assert (await stored('rh'))['status'] == 'done'
        await done.filter(has_text='Ligar para o RH').locator('[data-complete-task]').click()
        await expect(todo).to_have_count(4)
        assert (await stored('rh'))['status'] == 'todo'
        print('PASS Checking a demand moves it straight to Concluídas; unchecking brings it back', flush=True)

        # Linha do tempo: 48 px por hora; arrastar anda em passos de 15 min.
        await expect(page.locator('.timeline-block[data-block]')).to_have_count(3)
        await block('ouv').scroll_into_view_if_needed()

        async def drag(locator, dy, handle=None):
            target = locator.locator(handle) if handle else locator
            box = await target.bounding_box()
            x, y = box['x'] + box['width'] / 2, box['y'] + (box['height'] - 3 if handle else 8)
            await page.mouse.move(x, y)
            await page.mouse.down()
            await page.mouse.move(x, y + dy / 2, steps=4)
            await page.mouse.move(x, y + dy, steps=4)
            await page.mouse.up()

        await drag(block('ouv'), -48)
        await expect(block('ouv').locator('.timeline-time')).to_have_text('08:00–08:30')
        assert (await stored('ouv'))['plannedTime'] == '08:00'
        await expect(page.locator('.page-head h1')).to_have_text('Hoje')
        await drag(block('rel'), 24, '.timeline-resize')
        await expect(block('rel').locator('.timeline-time')).to_have_text('10:00–12:00')
        assert (await stored('rel'))['duration'] == 120
        print('PASS Dragging a block changes its time in 15-minute steps; pulling its bottom edge changes the ΔT', flush=True)

        await drag(block('late'), 48)
        await expect(todo.filter(has_text='Responder coordenação')).not_to_have_class('today-item is-late ')
        late = await stored('late')
        assert (late['plannedDate'], late['plannedTime'], late['dueDate']) == (TODAY, '12:00', TODAY), late
        await expect(page.locator('[data-action="today-filter"][data-filter="late"]')).to_have_text('Só atrasadas 0')
        print('PASS Dragging an overdue block brings it to today at the new time', flush=True)

        await block('ouv').focus()
        await page.keyboard.press('ArrowDown')
        await expect(block('ouv').locator('.timeline-time')).to_have_text('08:15–08:45')
        await expect(block('ouv')).to_be_focused()
        await page.keyboard.press('Shift+ArrowDown')
        await expect(block('ouv').locator('.timeline-time')).to_have_text('08:15–09:00')
        assert (await stored('ouv'))['duration'] == 45
        print('PASS Arrow keys move a focused block 15 minutes; Shift+arrows change its ΔT', flush=True)

        await block('rel').click()
        await expect(page.locator('.page-head h1')).to_have_text('Detalhe da tarefa')
        await expect(page.locator('.reserved-slot')).to_contain_text('10:00–12:00')
        await expect(page.locator('#edit-duration')).to_have_value('120')
        await page.locator('[data-action="detail-back"]').click()
        await expect(page.locator('.page-head h1')).to_have_text('Hoje')
        print('PASS A click on a block (without dragging) opens the demand; the back button returns to Hoje', flush=True)

        await page.evaluate(GOOGLE)
        await page.locator('[data-action="today-filter"][data-filter="both"]').click()  # redesenha com o Google conectado
        event = page.locator('.timeline-block.is-event')
        await expect(event).to_have_text('Reunião <CPA>13:00–14:00')
        await todo.filter(has_text='Ligar para o RH').locator('[data-action="plan-task"]').click()
        form = page.locator('#active-modal-form')
        await expect(form.locator('[name="day"]')).to_have_value(TODAY)
        await form.locator('[name="duration"]').select_option('30')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('#toast')).to_contain_text('Hoje · 14:00–14:30 · ΔT 30 min')
        rh = await stored('rh')
        assert (rh['plannedDate'], rh['plannedTime'], rh['duration']) == (TODAY, '14:00', 30), rh
        print('PASS Dia e ΔT reserves the first free time after now, around demands and Google Agenda appointments', flush=True)

        await page.locator('[data-action="today-tab"][data-tab="proximos"]').click()
        groups = page.locator('.next-day')
        await expect(groups.locator('h3')).to_have_text(['Amanhã · 10/10/2026', 'quarta-feira · 14/10/2026'])
        await expect(groups.first).to_contain_text('08:00–08:45')
        await expect(groups.first).to_contain_text('1 · 45 min reservados')
        await expect(groups.nth(1)).to_contain_text('Sem horário')
        print('PASS Próximos groups the next days (Amanhã first) with their reserved times', flush=True)

        await page.locator('#sidebar-nav [data-page="entrada"]').click()
        reminder = page.locator('#reminders [data-entry-card]').filter(has_text='Ideia: newsletter')
        await reminder.locator('[data-action="classify-task"]').click()
        await form.locator('[name="day"]').fill(TOMORROW)
        await form.locator('[name="duration"]').select_option('60')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('#reminders [data-entry-card]')).to_have_count(0)
        idea = await stored('idea')
        assert (idea['plannedDate'], idea['plannedTime'], idea['duration']) == (TOMORROW, '08:45', 60), idea
        await expect(page.locator('#inbox-count')).to_be_hidden()
        print('PASS A reminder without a day gets Dia e ΔT from the Entrada and takes the next free time of that day', flush=True)

        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(page.locator('.today-pane-switch')).to_be_visible()
        await expect(page.locator('.today-timeline')).to_be_hidden()
        await page.locator('[data-action="today-pane"][data-pane="horarios"]').click()
        await expect(page.locator('.today-timeline')).to_be_visible()
        await expect(page.locator('.today-todo .today-list')).to_be_hidden()
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        print('PASS On a phone Lista and Horários switch inside A fazer without horizontal overflow', flush=True)
        assert not errors, errors
        await browser.close()

asyncio.run(run())
