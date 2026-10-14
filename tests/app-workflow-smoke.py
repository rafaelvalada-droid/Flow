"""Browser checks of classification, shared pipeline, focus and legacy storage."""
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000')
KEY='flow.workspace.v1'

async def stored(page):
    # O app agrupa gravações; o mesmo evento usado pela extensão grava antes da leitura.
    return await page.evaluate("(key)=>{window.dispatchEvent(new Event('flow:persist-flush'));return JSON.parse(localStorage.getItem(key))}",KEY)

async def ready(page):
    # A abertura é assíncrona (configuração da conta); só depois dela o workspace é normalizado e gravado.
    await expect(page.locator('.app-shell')).not_to_have_attribute('aria-busy','true')

async def board_all(page):
    # A esteira abre no prazo Hoje; estes cenários precisam de todas as datas.
    await page.locator('#board-date-filter').select_option('all')

async def run(profile):
    checks=0
    def passed(message):
        nonlocal checks
        checks+=1
        print('PASS '+message,flush=True)
    async with async_playwright() as pw:
        context=await pw.chromium.launch_persistent_context(profile,executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'],viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo')
        page=await context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        await page.clock.install(time=datetime(2026,10,9,15,tzinfo=timezone.utc))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-board')).to_be_visible()
        await expect(page.locator('#board-date-filter')).to_have_value('today')
        assert await page.locator('.pipeline-task').count()==0
        await board_all(page)
        assert await page.locator('.pipeline-lane').count()==5
        assert await page.locator('.pipeline-task').count()==4
        await expect(page.locator('.brand')).to_have_text('UlbraFlow')
        passed('Default screen opens Entrada; Esteira defaults to Hoje e atrasadas and shows one shared pipeline and the UlbraFlow name')

        await page.locator('.top-actions [data-action="new-task"]').click()
        form=page.locator('#active-modal-form')
        assert await form.locator('[name="project"]').input_value()==''
        assert await form.locator('[name="dueDate"]').input_value()==''
        await form.locator('[name="title"]').fill('Conferir folha de outubro')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('.gmail-review-card[data-entry-card]')).to_have_count(1)
        await page.locator('.gmail-review-card[data-entry-card] [data-action="classify-task"]').click()
        await form.locator('[name="project"]').select_option('folha')
        await form.locator('[name="dueDate"]').fill('2026-10-09')
        await form.locator('[type="submit"]').click()
        card=page.locator('.pipeline-task').filter(has_text='Conferir folha de outubro')
        await expect(card.locator('.area-label')).to_have_text('Folha docente')
        await card.locator('summary').click()
        await expect(card.locator('.urgency')).to_contain_text('Hoje')
        await expect(page.locator('.pipeline-lane[data-stage="inbox"] .pipeline-task')).to_have_count(0)
        assert 'Conferir folha' in await page.locator('.pipeline-lane[data-stage="todo"] .pipeline-task').first.inner_text()
        passed('Capture stays in Entrada until area and date are chosen; deadline orders the shared queue')

        await page.locator('#sidebar-nav [data-page="projetos"]').click()
        assert await page.locator('.projectcard').count()==12
        assert await page.locator('.pipeline-board,.kanban').count()==0
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-filter').select_option('folha')
        await expect(page.locator('.pipeline-task')).to_have_count(1)
        await page.locator('#board-filter').select_option('all')
        await expect(page.locator('.pipeline-task')).to_have_count(5)
        await card.locator('[data-move-task]').select_option('waiting')
        await expect(page.locator('.pipeline-lane[data-stage="waiting"] .pipeline-task').filter(has_text='Conferir folha de outubro')).to_be_visible()
        await card.locator('[data-move-task]').select_option('todo')
        passed('Areas are classification views; all areas share the same execution board')

        await card.locator('[data-action="focus-task"]').click()
        await expect(page.locator('.focus-task-title')).to_have_text('Conferir folha de outubro')
        await expect(page.locator('[data-countdown]')).to_have_text('25:00')
        await page.clock.fast_forward(10000)
        await page.locator('[data-action="focus-pause"]').click()
        paused=await page.locator('[data-countdown]').inner_text()
        await page.reload()
        await page.locator('#sidebar-nav [data-page="foco"]').click()
        await expect(page.locator('[data-countdown]')).to_have_text(paused)
        await page.clock.fast_forward(30000)
        await expect(page.locator('[data-countdown]')).to_have_text(paused)
        await page.locator('#focus-minutes').fill('1')
        await page.locator('#focus-minutes').dispatch_event('change')
        await expect(page.locator('[data-countdown]')).to_have_text(paused)
        await page.locator('[data-action="focus-change"]').click()
        await page.locator('#focus-task-select').select_option(label='Conferir folha de outubro · Folha docente')
        await page.locator('[data-action="focus-start"]').click()
        await expect(page.locator('[data-countdown]')).to_have_text('01:00')
        passed('Focus survives reload; pause freezes the cycle; rhythm edits preserve the current cycle')

        state=await stored(page)
        deadline=state['focus']['endsAt']
        await page.clock.fast_forward(61000)
        await expect(page.locator('.focus-main .eyebrow')).to_have_text('PAUSA')
        state=await stored(page)
        focused=next(t for t in state['tasks'] if t['title']=='Conferir folha de outubro')
        assert focused['startedAt'] is None
        assert focused['sessions'][-1]['end']==deadline
        assert focused['focusCycles']==1
        worked=sum((s['end']-s['start']) for s in focused['sessions'])
        await page.clock.fast_forward(400000)
        await expect(page.locator('.focus-main .eyebrow')).to_have_text('CICLO CONCLUÍDO')
        state=await stored(page)
        focused=next(t for t in state['tasks'] if t['id']==focused['id'])
        assert sum(s['end']-s['start'] for s in focused['sessions'])==worked
        assert not any(t['startedAt'] for t in state['tasks'])
        passed('Cycle ends exactly at its deadline; breaks and unattended time add no work')

        await page.locator('[data-action="focus-start"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await board_all(page)
        await page.locator('.pipeline-task').filter(has_text='Conferir carga horária docente').locator('summary').click()
        await page.locator('.pipeline-task').filter(has_text='Conferir carga horária docente').locator('[data-action="focus-task"]').click()
        state=await stored(page)
        assert len([t for t in state['tasks'] if t['startedAt']])==1
        assert state['focus']['taskId']=='t1'
        await page.locator('[data-focus-sub]').first.check()
        state=await stored(page)
        assert next(t for t in state['tasks'] if t['id']=='t1')['subtasks'][0]['done']
        await page.locator('[data-action="focus-complete"]').click()
        state=await stored(page)
        assert state['focus'] is None and not any(t['startedAt'] for t in state['tasks'])
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-lane[data-stage="done"] .pipeline-task')).to_have_count(1)
        passed('Switching focus stops the previous task; subtasks and completion persist')

        Path('/tmp/flow-review').mkdir(exist_ok=True)
        await page.screenshot(path='/tmp/flow-review/esteira-desktop.png',full_page=True)
        await page.locator('#sidebar-nav [data-page="foco"]').click()
        await page.screenshot(path='/tmp/flow-review/foco-desktop.png',full_page=True)
        for width in [390,760,1024]:
            await page.set_viewport_size({'width':width,'height':844})
            await page.locator('#sidebar-nav [data-page="esteira"]').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('#sidebar-nav [data-page="foco"]').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path='/tmp/flow-review/foco-mobile.png',full_page=True)
        passed('Pipeline and focus fit mobile, tablet and desktop without page overflow')

        legacy=await context.new_page()
        await legacy.goto(BASE)
        old={'version':1,'projects':[{'id':'old','name':'Área antiga','color':'#3268dc'}],'tasks':[{'id':'legacy','title':'Meu trabalho existente','project':'old','status':'todo','priority':'high','dueDate':'2026-10-11','description':'Notas preservadas','subtasks':[{'id':'s','text':'Passo antigo','done':True}],'sessions':[{'start':10000,'end':15000}],'startedAt':None}],'preferences':{'reminderDays':7,'alerts':[False,True,False,True]}}
        await legacy.evaluate('(data)=>localStorage.setItem("flow.workspace.v1",JSON.stringify(data))',old)
        await legacy.reload()
        await ready(legacy)
        migrated=await stored(legacy)
        assert old['projects'][0] in migrated['projects']
        assert len(migrated['projects'])==13
        for k,v in old['tasks'][0].items(): assert migrated['tasks'][0][k]==v
        assert migrated['preferences']['reminderDays']==7
        assert migrated['preferences']['focusMinutes']==25
        passed('Version-one storage upgrades without replacing user areas, tasks or history')
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await page.locator('#board-filter').select_option('all')
        title='Revisar retorno de etapa'
        await page.locator('.top-actions [data-action="new-task"]').click()
        form=page.locator('#active-modal-form')
        await form.locator('[name="title"]').fill(title)
        await form.locator('[name="project"]').select_option('folha')
        await form.locator('[name="dueDate"]').fill('2026-10-20')
        await form.locator('[type="submit"]').click()
        card=page.locator('.pipeline-lane[data-stage="todo"] .pipeline-task').filter(has_text=title)
        if not await card.locator('details').evaluate('(node)=>node.open'): await card.locator('summary').click()
        await card.locator('[data-action="advance-task"]').click()
        card=page.locator('.pipeline-lane[data-stage="doing"] .pipeline-task').filter(has_text=title)
        await card.locator('[data-action="return-task"]').click()
        card=page.locator('.pipeline-lane[data-stage="todo"] .pipeline-task').filter(has_text=title)
        await expect(card).to_be_visible()
        await card.locator('[data-action="advance-task"]').click()
        card=page.locator('.pipeline-lane[data-stage="doing"] .pipeline-task').filter(has_text=title)
        await expect(card).to_be_visible()
        await card.locator('[data-action="advance-task"]').click()
        card=page.locator('.pipeline-lane[data-stage="waiting"] .pipeline-task').filter(has_text=title)
        await card.locator('[data-action="advance-task"]').click()
        card=page.locator('.pipeline-lane[data-stage="done"] .pipeline-task').filter(has_text=title)
        await expect(card.locator('[data-action="advance-task"]')).to_have_count(0)
        await card.locator('[data-action="task-detail"]').click()
        await expect(page.locator('#edit-status')).to_have_value('done')
        await page.locator('[data-action="return-task"]').click()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await expect(page.locator('.pipeline-lane[data-stage="waiting"] .pipeline-task').filter(has_text=title)).to_be_visible()
        passed('Retornar reverses an accidental advance without removing classification')
        await page.locator('[data-action="toggle-done"]').click()
        await expect(page.locator('.pipeline-lane')).to_have_count(4)
        await expect(page.locator('.pipeline-direction li')).to_have_count(4)
        await expect(page.locator('.pipeline-lane[data-stage="done"]')).to_have_count(0)
        await page.locator('[data-action="toggle-done"]').click()
        await expect(page.locator('.pipeline-lane')).to_have_count(5)
        passed('Completed column can be hidden and restored without removing tasks')

        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('.top-actions [data-action="new-task"]').click()
        form=page.locator('#active-modal-form')
        await form.locator('[name="title"]').fill('Demanda agendada às 14h')
        await form.locator('[name="plannedDate"]').fill('2026-10-20')
        await form.locator('[name="plannedTime"]').fill('14:00')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('.calendar-grid')).to_be_visible()
        event=page.locator('.calendar-event').filter(has_text='Demanda agendada às 14h')
        await expect(event).to_contain_text('14:00')
        await page.reload()
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('[data-action="week-next"]').click()
        await page.locator('[data-action="week-next"]').click()
        await expect(page.locator('.calendar-event').filter(has_text='Demanda agendada às 14h')).to_contain_text('14:00')
        passed('Creation in Agenda saves execution date/time, keeps Agenda open and reveals the selected week')
        # A delayed AI result belongs to its source task, even if another detail is opened.
        ai_gate=asyncio.Event();ai_started=asyncio.Event()
        async def ai_response(route):
            ai_started.set();await ai_gate.wait();await route.fulfill(json={'text':'Sugestão destinada à primeira tarefa'})
        await page.route('**/api/gemini',ai_response)
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await board_all(page)
        ids=[t['id'] for t in (await stored(page))['tasks'] if t.get('dueDate') and t.get('project')][:2]
        async def detail(task_id):
            demand=page.locator(f'details[data-demand="{task_id}"]')
            if not await demand.evaluate('(node)=>node.open'):await demand.locator('summary').click()
            await demand.locator('[data-action="task-detail"]').click()
        await detail(ids[0])
        await page.locator('#edit-description').fill('Contexto da tarefa de origem')
        await page.locator('#edit-description').dispatch_event('change')
        page.once('dialog',lambda dialog:dialog.accept('test-password'))
        await page.locator('[data-action="gemini"]').click();await asyncio.wait_for(ai_started.wait(),timeout=10)
        await page.locator('#sidebar-nav [data-page="esteira"]').click();await detail(ids[1]);ai_gate.set()
        await expect(page.locator('[data-action="gemini"]')).to_be_enabled()
        await expect(page.locator('.ai-suggestion')).to_have_count(0)
        passed('A late Gemini suggestion never appears on a different task')
        assert not errors,errors
        passed('No uncaught JavaScript errors')
        await context.close()
    print(f'{checks} app browser checks passed.',flush=True)

with TemporaryDirectory(prefix='flow-app-test-') as profile:
    asyncio.run(run(profile))
