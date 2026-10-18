"""Criar demanda com Gemini na Entrada: gravação real do navegador (microfone simulado do Chromium), envio
com áreas e data de hoje, demanda criada já classificada ou na Entrada, desfazer, texto digitado, falhas e
reenvio em WAV. A rota /api/voice-note e a nuvem são simuladas."""
import asyncio
import base64
import os
import struct
from datetime import date, timedelta
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
FAKE_CLOUD = '''window.FlowCloud={initialize:async()=>({mode:'cloud',key:'test-workspace',data:{version:1,areaCatalogVersion:5,projects:[{id:'oferta',name:'Oferta de turmas',color:'#507ee9'}],tasks:[],preferences:{}}}),info:()=>({mode:'cloud',user:{id:'test-owner',email:'user@ulbra.br'},status:'saved'}),queue:()=>{},flush:async()=>{},calendarToken:()=>null,gmailToken:()=>null,signIn:async()=>{},
voiceNote:async body=>{const r=await fetch('/api/voice-note',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{status:r.status,code:data.code});return data}};'''
DUE = (date.today() + timedelta(days=7)).isoformat()
CLASSIFIED = {'title': 'Relatório de matrículas', 'description': 'Consolidar os números da oferta.', 'areaId': 'oferta', 'projectId': '', 'dueDate': DUE,
              'dateEvidence': 'sexta que vem', 'duration': 45, 'transcript': 'Relatório de matrículas. Classificação oferta. Consolidar os números da oferta. Sexta que vem. Reserve 45 minutos. Subtarefas: um, levantar os dados; dois, montar a planilha.',
              'subtasks': ['Levantar os dados', 'Montar a planilha'], 'modelUsed': 'gemini-2.5-flash'}
# Área inexistente e sem prazo: a demanda fica na Entrada para completar a classificação.
PARTIAL = {'title': 'Ligar para a coordenação', 'description': '', 'areaId': 'inexistente', 'dueDate': '', 'dateEvidence': '', 'transcript': 'Ligar para a coordenação.', 'subtasks': []}
TYPED = {'title': 'Conferir a escala', 'description': '', 'areaId': 'oferta', 'dueDate': DUE, 'dateEvidence': 'dia 25', 'transcript': 'Conferir a escala, área oferta, até dia 25', 'subtasks': []}


async def stored(page):
    return await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).tasks")


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                                          args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        context = await browser.new_context(viewport={'width': 1280, 'height': 1000})
        state = {'requests': [], 'fail': False, 'wav_only': False, 'answer': CLASSIFIED}

        async def route(req):
            url = req.request.url
            if url.endswith('/cloud.js') or '/cloud.js?' in url:
                await req.fulfill(content_type='text/javascript', body=FAKE_CLOUD)
            elif '/api/voice-note' in url:
                body = req.request.post_data_json
                state['requests'].append(body)
                if state['fail']:
                    await req.fulfill(status=502, json={'error': 'O Gemini demorou demais para responder.'})
                elif state['wav_only'] and 'audio' in body and body['mimeType'] != 'audio/wav':
                    await req.fulfill(status=502, json={'error': 'O Gemini recusou o pedido.', 'upstreamStatus': 400, 'code': 'audio-format'})
                else:
                    await req.fulfill(json=TYPED if 'text' in body else state['answer'])
            else:
                await req.continue_()
        await context.route('**/*', route)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        voice = page.locator('#voice-notes')
        record = voice.get_by_role('button', name='Falar demanda')
        result = voice.locator('.voice-result')
        await expect(voice).to_contain_text('Fale nesta ordem: nome da demanda, classificação, descrição, data e ΔT (tempo previsto). Só o nome e a classificação são obrigatórios')
        today = await page.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")

        await record.click()
        await expect(voice.locator('#voice-time')).to_be_visible()
        await expect(voice.locator('#voice-time')).not_to_have_text('0:00', timeout=4000)
        level = 0
        for _ in range(40):
            level = await page.evaluate("parseFloat(document.getElementById('voice-level')?.style.width)||0")
            if level > 0:
                break
            await page.wait_for_timeout(100)
        assert level > 0, 'o medidor de nível não reagiu ao microfone'
        await voice.get_by_role('button', name='Cancelar').click()
        await expect(record).to_be_visible()
        assert state['requests'] == []
        print('PASS Recording shows a running clock and a live level meter; Cancelar discards it without sending anything', flush=True)

        await record.click()
        await page.wait_for_timeout(2200)
        await voice.get_by_role('button', name='Parar e criar demanda').click()
        await expect(result).to_contain_text(CLASSIFIED['title'])
        sent = state['requests'][-1]
        assert sent['mode'] == 'demand' and sent['today'] == today and sent['mimeType'].startswith('audio/') and len(sent['audio']) > 1000, {k: (v if k != 'audio' else len(v)) for k, v in sent.items()}
        assert {'id': 'oferta', 'name': 'Oferta de turmas'} in sent['areas'], sent['areas']
        await expect(result).to_contain_text('Oferta de turmas')
        await expect(result).to_contain_text('“sexta que vem”')
        await expect(result).to_contain_text('08:00–08:45')
        await expect(result).to_contain_text('ΔT 45 min')
        await expect(result).to_contain_text('Está em Próximos, com o horário reservado.')
        await expect(result).to_contain_text('Entendi: “' + CLASSIFIED['transcript'] + '”')
        await expect(result.locator('.voice-subtasks-title')).to_have_text('Subtarefas (2)')
        await expect(result.locator('.voice-subtasks li')).to_have_text(CLASSIFIED['subtasks'])
        task = (await stored(page))[0]
        assert task['title'] == CLASSIFIED['title'] and task['project'] == 'oferta' and task['dueDate'] == DUE and task['status'] == 'todo', task
        assert (task['plannedDate'], task['plannedTime'], task['duration']) == (DUE, '08:00', 45), task
        assert sent['projects'] == [], sent['projects']
        assert task['source'] == 'voice' and task['description'] == CLASSIFIED['description'] and task['geminiClassified'] is True, task
        assert [(sub['text'], sub['done']) for sub in task['subtasks']] == [('Levantar os dados', False), ('Montar a planilha', False)] and all(sub['id'] for sub in task['subtasks']), task['subtasks']
        await expect(page.locator('[data-entry-card]').filter(has_text=CLASSIFIED['title'])).to_have_count(0)
        await result.get_by_role('button', name='Abrir demanda').click()
        await expect(page.locator('label.subtask')).to_contain_text(CLASSIFIED['subtasks'])
        await page.locator('#sidebar-nav [data-page="entrada"]').click()
        await expect(result).to_contain_text(CLASSIFIED['title'])
        print('PASS Speaking a demand sends the whole recording with the areas and today; it is created with its day, ΔT, reserved time and subtasks', flush=True)

        await voice.get_by_role('button', name='Desfazer').click()
        await expect(result).to_have_count(0)
        await expect(record).to_be_visible()
        assert await stored(page) == []
        print('PASS Desfazer removes the demand that was just created', flush=True)

        state['answer'] = PARTIAL
        await record.click()
        await page.wait_for_timeout(1500)
        await voice.get_by_role('button', name='Parar e criar demanda').click()
        await expect(result).to_contain_text('Ficou nos lembretes da Entrada (sem data)')
        await expect(result).to_contain_text('Falta a classificação')
        await expect(result.get_by_role('button', name='Dia e ΔT →')).to_be_visible()
        await expect(page.locator('#reminders [data-entry-card]').filter(has_text=PARTIAL['title'])).to_have_count(1)
        card = page.locator('[data-entry-card]').filter(has_text=PARTIAL['title'])
        await expect(card).to_contain_text('Criada com Gemini')
        task = (await stored(page))[0]
        assert task['project'] == '' and task['dueDate'] == '' and task['geminiClassified'] is False and task['subtasks'] == [], task
        await expect(result.locator('.voice-subtasks')).to_have_count(0)
        print('PASS Without a known area or a date the demand waits in the Entrada, marked as created with Gemini', flush=True)

        typed = voice.locator('#voice-typed')
        await expect(voice.get_by_role('button', name='Criar com Gemini')).to_be_disabled()
        await typed.fill('Conferir a escala, área oferta, até dia 25')
        await typed.press('Enter')
        await expect(result).to_contain_text(TYPED['title'])
        assert state['requests'][-1] == {'mode': 'demand', 'today': today, 'areas': sent['areas'], 'projects': [], 'text': 'Conferir a escala, área oferta, até dia 25'}, state['requests'][-1]
        await expect(typed).to_have_value('')
        assert [t['title'] for t in await stored(page)][:2] == [TYPED['title'], PARTIAL['title']]
        print('PASS A typed demand goes to Gemini the same way (Enter or the button) and the field is cleared', flush=True)

        state['fail'] = True
        state['answer'] = CLASSIFIED
        await record.click()
        await page.wait_for_timeout(1500)
        await voice.get_by_role('button', name='Parar e criar demanda').click()
        await expect(voice.locator('.voice-error')).to_contain_text('Não foi possível criar a demanda')
        assert (await voice.locator('audio').get_attribute('src')).startswith('blob:')
        await page.evaluate("document.querySelector('#voice-notes')._old=1;document.querySelector('#voice-notes .voice-audio')._kept=1")
        await typed.click()
        await typed.press_sequentially('Rascunho')
        await page.evaluate("dispatchEvent(new CustomEvent('flow:cloud-remote-merged',{detail:{data:JSON.parse(localStorage.getItem('test-workspace'))}}))")
        kept = await page.evaluate("({redrawn:!document.querySelector('#voice-notes')._old,audio:document.querySelector('#voice-notes .voice-audio')._kept===1,focus:document.activeElement.id})")
        assert kept == {'redrawn': True, 'audio': True, 'focus': 'voice-typed'}, kept
        await expect(typed).to_have_value('Rascunho')
        await typed.fill('')
        state['fail'] = False
        await voice.get_by_role('button', name='Tentar de novo').click()
        await expect(result).to_contain_text(CLASSIFIED['title'])
        await expect(voice.locator('.voice-error')).to_have_count(0)
        print('PASS A failed request keeps the recording to retry; a background redraw keeps the audio, the typed text and the cursor', flush=True)

        state['wav_only'] = True
        before = len(state['requests'])
        await record.click()
        await page.wait_for_timeout(2200)
        await voice.get_by_role('button', name='Parar e criar demanda').click()
        await expect(result).to_contain_text(CLASSIFIED['title'])
        compressed, wav = state['requests'][before:]
        assert compressed['mimeType'] != 'audio/wav' and wav['mimeType'] == 'audio/wav', (compressed['mimeType'], wav['mimeType'])
        header = base64.b64decode(wav['audio'][:64])
        rate = struct.unpack('<I', header[24:28])[0]
        assert header[:4] == b'RIFF' and header[8:12] == b'WAVE' and struct.unpack('<H', header[22:24])[0] == 1 and rate == 16000, header
        pcm = base64.b64decode(wav['audio'])[44:]
        seconds = len(pcm) / (rate * 2)
        assert 1.5 < seconds < 3.5, seconds
        peak = max(abs(v) for (v,) in struct.iter_unpack('<h', pcm[:len(pcm) // 2 * 2]))
        assert peak > 1000, f'o WAV ficou em silêncio (pico {peak})'
        state['wav_only'] = False
        print('PASS When Gemini refuses the browser audio format, the recording is resent once as 16 kHz mono WAV', flush=True)

        await page.set_viewport_size({'width': 390, 'height': 844})
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await record.click()
        await expect(voice.get_by_role('button', name='Parar e criar demanda')).to_be_visible()
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await voice.get_by_role('button', name='Cancelar').click()
        print('PASS The result card and the recording controls fit a 390 px phone', flush=True)

        denied = await context.new_page()
        denied.on('pageerror', lambda error: errors.append(str(error)))
        await denied.add_init_script("navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))")
        await denied.goto(BASE)
        await denied.locator('#voice-notes').get_by_role('button', name='Falar demanda').click()
        await expect(denied.locator('#voice-notes .voice-error')).to_contain_text('O microfone está bloqueado')
        await expect(denied.locator('#voice-typed')).to_be_visible()
        print('PASS A blocked microphone explains how to allow it and the demand can still be typed', flush=True)
        assert not errors, errors
        await browser.close()

asyncio.run(run())
