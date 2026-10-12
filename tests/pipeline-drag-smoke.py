"""Browser checks for stage dragging, classification and work-time preservation.

Desktop gestures use Chromium's native HTML drag/drop. The mobile checks send
synthetic touch pointer events through the real UI; they do not claim to test
native gestures on an Android device. All account data is local test data.
"""
import asyncio
import os
from datetime import datetime, timezone
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
KEY = 'flow.workspace.v1'
TASK = 'drag-classified'
INBOX = 'drag-unclassified'


async def state(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)


def task(db, task_id=TASK):
    return next(item for item in db['tasks'] if item['id'] == task_id)


async def seed(page):
    await page.clock.install(time=datetime(2026, 10, 12, 15, tzinfo=timezone.utc))
    await page.goto(BASE)
    await expect(page.locator('.page-head h1')).to_have_text('Entrada')
    await page.evaluate("""key => {
      const db=JSON.parse(localStorage.getItem(key));
      const demand={id:'drag-classified',title:'Revisar folha pelo arraste',project:'folha',
        status:'todo',priority:'high',dueDate:'2026-10-20',plannedDate:'2026-10-19',
        plannedTime:'14:00',description:'Notas e contexto que precisam ser preservados.',
        subtasks:[{id:'drag-step',text:'Conferir valores',done:true}],
        sessions:[{start:1791806400000,end:1791806460000}],startedAt:null,focusCycles:2,
        gmailUrl:'https://mail.google.com/mail/u/0/#inbox/abcdefghijklmnop',
        gmailSender:'docente@example.com',gmailSubject:'Folha de outubro',
        createdAt:1791800000000,completedAt:null,initiativeId:null};
      db.tasks=[demand,{...demand,id:'drag-unclassified',title:'Entrada sem classificação',
        project:'',dueDate:'',sessions:[],subtasks:[],gmailUrl:'',description:'Entrada original.'}];
      db.focus=null;
      localStorage.setItem(key,JSON.stringify(db));
    }""", KEY)
    await page.reload()
    await page.locator('#sidebar-nav [data-page="esteira"]').click()
    await expect(page.locator(f'[data-pipeline-task="{TASK}"]')).to_be_visible()


def card(page, task_id=TASK):
    return page.locator(f'.pipeline-task[data-pipeline-task="{task_id}"]')


async def desktop_drag(page, stage, task_id=TASK):
    await card(page, task_id).drag_to(
        page.locator(f'.pipeline-lane[data-stage="{stage}"]'),
        source_position={'x': 14, 'y': 14}, target_position={'x': 50, 'y': 45},
    )
    await page.clock.run_for(450)


async def assert_stage(page, stage, task_id=TASK):
    await expect(page.locator(
        f'.pipeline-lane[data-stage="{stage}"] [data-pipeline-task="{task_id}"]'
    )).to_be_visible()


async def touch(page, event, x, y):
    # Chromium dispatches real pointer events and maintains valid pointer
    # capture from these synthetic browser-protocol touch inputs.
    session = getattr(page, '_pipeline_touch_session', None)
    if session is None:
        session = await page.context.new_cdp_session(page)
        page._pipeline_touch_session = session
    kinds = {'pointerdown':'touchStart','pointermove':'touchMove',
             'pointerup':'touchEnd','pointercancel':'touchCancel'}
    points = [] if event in ['pointerup','pointercancel'] else [{'x':x,'y':y,'id':42}]
    await session.send('Input.dispatchTouchEvent', {'type':kinds[event],'touchPoints':points})


async def touch_start(page):
    handle = page.locator(f'[data-drag-task="{TASK}"]')
    await handle.scroll_into_view_if_needed()
    box = await handle.bounding_box()
    x, y = box['x']+box['width']/2, box['y']+box['height']/2
    await touch(page, 'pointerdown', x, y)
    await touch(page, 'pointermove', x+20, y+5)
    await expect(page.locator('.pipeline-drag-preview')).to_be_visible()
    return x, y


async def main():
    checks = 0
    def passed(message):
        nonlocal checks
        checks += 1
        print('PASS '+message, flush=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/chromium',
            headless=True, args=['--no-sandbox'])
        desktop = await browser.new_context(viewport={'width':1440,'height':1000},
            timezone_id='America/Sao_Paulo')
        page = await desktop.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await seed(page)
        original = task(await state(page))
        for stage in ['doing', 'waiting', 'done']:
            await desktop_drag(page, stage)
            await assert_stage(page, stage)
        finished = task(await state(page))
        assert finished['completedAt'] is not None
        for key,value in original.items():
            if key not in ['status','completedAt']:
                assert finished[key] == value, key
        await page.reload()
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await assert_stage(page, 'done')
        assert task(await state(page)) == finished
        passed('Native dragging advances stages and persists completion without losing task data')

        await desktop_drag(page, 'todo')
        await assert_stage(page, 'todo')
        reopened = task(await state(page))
        assert reopened['completedAt'] is None
        assert reopened['sessions'] == original['sessions']
        assert reopened['project'] == original['project'] and reopened['dueDate'] == original['dueDate']
        passed('Dragging a completed demand back reopens it and preserves area, date and history')

        before = task(await state(page))
        source = await card(page).bounding_box()
        destination = await page.locator('.pipeline-lane[data-stage="waiting"]').bounding_box()
        await page.mouse.move(source['x']+14,source['y']+14)
        await page.mouse.down()
        await page.mouse.move(destination['x']+50,destination['y']+45,steps=15)
        await page.keyboard.press('Escape')
        await page.mouse.up()
        await page.clock.run_for(450)
        assert task(await state(page)) == before
        await assert_stage(page, 'todo')
        passed('Escape cancels a native drag without changing the demand')

        await desktop_drag(page, 'inbox')
        assert task(await state(page)) == before
        await assert_stage(page, 'todo')
        passed('Dropping into A classificar cannot erase an existing classification')

        pending = task(await state(page), INBOX)
        await desktop_drag(page, 'doing', INBOX)
        form = page.locator('#active-modal-form')
        await expect(form).to_be_visible()
        assert task(await state(page), INBOX) == pending
        await page.keyboard.press('Escape')
        await assert_stage(page, 'inbox', INBOX)
        assert task(await state(page), INBOX) == pending
        passed('Unclassified drag requests area/date and cancel leaves the original entry intact')

        details = card(page).locator('details')
        await details.locator('summary').click()
        await expect(details.locator('[data-action="task-detail"]')).to_be_visible()
        await details.locator('summary').click()
        assert not await details.evaluate('(el)=>el.open')
        await details.locator('summary').click()
        await details.locator('[data-action="task-detail"]').click()
        await expect(page.locator('#edit-title')).to_have_value(original['title'])
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        passed('Normal accordion clicks and task details remain available after dragging')

        details = card(page).locator('details')
        if not await details.evaluate('(el)=>el.open'):
            await details.locator('summary').click()
        await details.locator('[data-action="focus-task"]').click()
        await page.clock.fast_forward(10000)
        await page.locator('#sidebar-nav [data-page="esteira"]').click()
        await desktop_drag(page, 'waiting')
        stopped = await state(page)
        work = task(stopped)
        assert work['startedAt'] is None and stopped['focus'] is None
        assert work['sessions'][:-1] == original['sessions']
        assert work['sessions'][-1]['end']-work['sessions'][-1]['start'] >= 10000
        assert work['sessions'][-1]['end']-work['sessions'][-1]['start'] < 12000
        passed('Dragging an active task to waiting stops its timer and closes the work session')

        mobile = await browser.new_context(viewport={'width':390,'height':844},
            has_touch=True,is_mobile=True,timezone_id='America/Sao_Paulo')
        phone = await mobile.new_page()
        phone.on('pageerror', lambda error: errors.append(str(error)))
        await seed(phone)
        baseline = task(await state(phone))
        x,y = await touch_start(phone)
        await touch(phone,'pointercancel',x+20,y+5)
        await expect(phone.locator('.pipeline-drag-preview')).to_have_count(0)
        assert task(await state(phone)) == baseline
        passed('Synthetic mobile touch cancellation removes the preview without mutating data')

        await phone.locator(f'[data-drag-task="{TASK}"]').tap()
        await expect(phone.locator('#active-modal-form [name="stage"]')).to_be_visible()
        await phone.keyboard.press('Escape')
        assert task(await state(phone)) == baseline
        passed('A mobile grip tap opens the stage chooser without accidentally moving the demand')

        _, y = await touch_start(phone)
        board = phone.locator('.pipeline-board')
        initial_scroll = await board.evaluate('(el)=>el.scrollLeft')
        rect = await board.bounding_box()
        # Hold the captured touch near the board edge. The real animation-frame
        # auto-scroll exposes the next lane on the narrow phone viewport.
        await touch(phone,'pointermove',rect['x']+rect['width']-12,y)
        await phone.clock.run_for(300)
        assert await board.evaluate('(el)=>el.scrollLeft') > initial_scroll
        target = await phone.locator('.pipeline-lane[data-stage="doing"]').bounding_box()
        x,y = min(365,target['x']+60),target['y']+45
        await touch(phone,'pointermove',x,y)
        await touch(phone,'pointerup',x,y)
        await phone.clock.run_for(450)
        await assert_stage(phone,'doing')
        moved = task(await state(phone))
        assert moved == {**baseline,'status':'doing'}
        assert await phone.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        passed('Synthetic mobile grip drag scrolls to the next lane and preserves classification without page overflow')

        assert not errors, errors
        passed('Desktop and synthetic mobile workflows have no uncaught JavaScript errors')
        await browser.close()
    print(f'{checks} pipeline-drag browser checks passed.',flush=True)


if __name__ == '__main__':
    asyncio.run(main())
