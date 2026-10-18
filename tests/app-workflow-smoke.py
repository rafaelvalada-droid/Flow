"""Browser checks of the Entrada → Hoje flow, Dia e ΔT, focus and legacy storage."""
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

async def open_task(page, task_id):
    """Opens a demand from Hoje or Próximos, wherever its day puts it."""
    await page.locator('#sidebar-nav [data-page="hoje"]').click()
    item = page.locator(f'[data-today-task="{task_id}"]')
    if not await item.count():
        await page.locator('[data-action="today-tab"][data-tab="proximos"]').click()
    await item.locator('.today-open').click()

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
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(page.locator('.today-tabs [role="tab"]')).to_have_text(['Hoje 0','Próximos 4'])
        await expect(page.locator('.today-todo .today-item')).to_have_count(0)
        await page.locator('[data-action="today-tab"][data-tab="proximos"]').click()
        await expect(page.locator('.next-day').first).to_contain_text('Amanhã')
        await expect(page.locator('.next-day').first).to_contain_text('Conferir carga horária docente')
        await expect(page.locator('.next-day .today-item')).to_have_count(4)
        await expect(page.locator('.brand')).to_have_text('UlbraFlow')
        passed('Default screen opens Entrada; Hoje starts empty and Próximos lists the upcoming demands by day')

        await page.locator('.top-actions [data-action="new-task"]').click()
        form=page.locator('#active-modal-form')
        assert await form.locator('[name="project"]').input_value()==''
        assert await form.locator('[name="dueDate"]').input_value()==''
        await form.locator('[name="title"]').fill('Conferir folha de outubro')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        reminders=page.locator('#reminders [data-entry-card]')
        await expect(reminders).to_have_count(1)
        await expect(page.locator('#inbox-count')).to_have_text('1')
        await reminders.locator('[data-action="classify-task"]').click()
        await form.locator('[name="project"]').select_option('folha')
        await form.locator('[data-action="plan-day"]').first.click()
        assert await form.locator('[name="day"]').input_value()=='2026-10-09'
        await form.locator('[name="duration"]').select_option('30')
        await form.locator('[type="submit"]').click()
        await expect(reminders).to_have_count(0)
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await page.locator('[data-action="today-tab"][data-tab="hoje"]').click()
        card=page.locator('.today-todo .today-item').filter(has_text='Conferir folha de outubro')
        await expect(card.locator('.area-label')).to_have_text('Folha docente')
        await expect(card.locator('.today-time')).to_have_text('12:00–12:30')
        await expect(page.locator('#today-count')).to_have_text('1')
        passed('A capture without a day stays in the Entrada reminders; Dia e ΔT sends it to Hoje with the first free time after now')

        await page.locator('#sidebar-nav [data-page="projetos"]').click()
        assert await page.locator('.projectcard').count()==12
        assert await page.locator('.today-layout,.pipeline-board,.kanban').count()==0
        assert await page.locator('#sidebar-nav [data-page="esteira"]').count()==0
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(card).to_be_visible()
        passed('Areas are classification views; the old Esteira is gone and Hoje is the execution view')

        await card.locator('.today-open').click()
        await page.locator('[data-action="start"]').click()
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
        await open_task(page,'t1')
        await page.locator('[data-action="start"]').click()
        state=await stored(page)
        assert len([t for t in state['tasks'] if t['startedAt']])==1
        assert state['focus']['taskId']=='t1'
        await page.locator('[data-focus-sub]').first.check()
        state=await stored(page)
        assert next(t for t in state['tasks'] if t['id']=='t1')['subtasks'][0]['done']
        await page.locator('[data-action="focus-complete"]').click()
        state=await stored(page)
        assert state['focus'] is None and not any(t['startedAt'] for t in state['tasks'])
        await page.locator('#sidebar-nav [data-page="hoje"]').click()
        await expect(page.locator('.today-done .today-item').filter(has_text='Conferir carga horária docente')).to_have_count(1)
        passed('Switching focus stops the previous task; subtasks and completion persist')

        Path('/tmp/flow-review').mkdir(exist_ok=True)
        await page.screenshot(path='/tmp/flow-review/hoje-desktop.png',full_page=True)
        await page.locator('#sidebar-nav [data-page="foco"]').click()
        await page.screenshot(path='/tmp/flow-review/foco-desktop.png',full_page=True)
        for width in [390,760,1024]:
            await page.set_viewport_size({'width':width,'height':844})
            await page.locator('#sidebar-nav [data-page="hoje"]').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('#sidebar-nav [data-page="foco"]').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path='/tmp/flow-review/foco-mobile.png',full_page=True)
        passed('Hoje and focus fit mobile, tablet and desktop without page overflow')

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
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('.top-actions [data-action="new-task"]').click()
        form=page.locator('#active-modal-form')
        await form.locator('[name="title"]').fill('Demanda agendada com ΔT')
        await form.locator('[name="dueDate"]').fill('2026-10-20')
        await form.locator('[name="duration"]').select_option('60')
        await form.locator('[type="submit"]').click()
        await expect(page.locator('.calendar-grid')).to_be_visible()
        event=page.locator('.calendar-event').filter(has_text='Demanda agendada com ΔT')
        await expect(event).to_contain_text('08:00')
        await page.reload()
        await page.locator('#sidebar-nav [data-page="agenda"]').click()
        await page.locator('[data-action="week-next"]').click()
        await page.locator('[data-action="week-next"]').click()
        await expect(page.locator('.calendar-event').filter(has_text='Demanda agendada com ΔT')).to_contain_text('08:00')
        passed('Creation in Agenda with Dia and ΔT reserves the first free time, keeps Agenda open and reveals the selected week')
        # A delayed AI result belongs to its source task, even if another detail is opened.
        ai_gate=asyncio.Event();ai_started=asyncio.Event()
        async def ai_response(route):
            ai_started.set();await ai_gate.wait();await route.fulfill(json={'text':'Sugestão destinada à primeira tarefa'})
        await page.route('**/api/gemini',ai_response)
        # A aba de migração gravou o workspace antigo: restam a tarefa migrada e a criada na Agenda, ambas com dia.
        ids=[t['id'] for t in (await stored(page))['tasks'] if t.get('dueDate') and t['status']!='done'][:2]
        assert len(ids)==2,ids
        async def detail(task_id):
            await open_task(page,task_id)
        await detail(ids[0])
        await page.locator('#edit-description').fill('Contexto da tarefa de origem')
        await page.locator('#edit-description').dispatch_event('change')
        page.once('dialog',lambda dialog:dialog.accept('test-password'))
        await page.locator('[data-action="gemini"]').click();await asyncio.wait_for(ai_started.wait(),timeout=10)
        await detail(ids[1]);ai_gate.set()
        await expect(page.locator('[data-action="gemini"]')).to_be_enabled()
        await expect(page.locator('.ai-suggestion')).to_have_count(0)
        passed('A late Gemini suggestion never appears on a different task')
        assert not errors,errors
        passed('No uncaught JavaScript errors')
        await context.close()
    print(f'{checks} app browser checks passed.',flush=True)

with TemporaryDirectory(prefix='flow-app-test-') as profile:
    asyncio.run(run(profile))
