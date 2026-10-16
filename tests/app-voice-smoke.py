"""Lembretes de voz na Entrada: gravação real do navegador (microfone simulado do Chromium), transcrição,
melhoria com Gemini, salvamento como entrada e falhas. A rota /api/voice-note e a nuvem são simuladas."""
import asyncio
import base64
import struct
import os
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('FLOW_TEST_URL', 'http://127.0.0.1:3000')
FAKE_CLOUD = '''window.FlowCloud={initialize:async()=>({mode:'cloud',key:'test-workspace',data:{version:1,areaCatalogVersion:5,projects:[{id:'oferta',name:'Oferta de turmas',color:'#507ee9'}],tasks:[],preferences:{}}}),info:()=>({mode:'cloud',user:{id:'test-owner',email:'user@ulbra.br'},status:'saved'}),queue:()=>{},flush:async()=>{},calendarToken:()=>null,gmailToken:()=>null,signIn:async()=>{},
voiceNote:async body=>{const r=await fetch('/api/voice-note',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{status:r.status,code:data.code});return data}};'''
TRANSCRIBED = {'text': 'Ligar para a coordenação amanhã sobre a escala.', 'title': 'Ligar para a coordenação'}
IMPROVED = {'text': 'Ligar amanhã para a coordenação e confirmar a escala.', 'title': 'Confirmar a escala com a coordenação'}


async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                                          args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        context = await browser.new_context(viewport={'width': 1280, 'height': 1000})
        state = {'requests': [], 'fail': False}

        async def route(req):
            url = req.request.url
            if url.endswith('/cloud.js') or '/cloud.js?' in url:
                await req.fulfill(content_type='text/javascript', body=FAKE_CLOUD)
            elif '/api/voice-note' in url:
                body = req.request.post_data_json
                state['requests'].append(body)
                if state['fail']:
                    await req.fulfill(status=502, json={'error': 'O Gemini demorou demais para responder.'})
                elif state.get('wav_only') and body.get('mimeType', 'audio/wav') != 'audio/wav':
                    await req.fulfill(status=502, json={'error': 'O Gemini recusou o pedido.', 'upstreamStatus': 400, 'code': 'audio-format'})
                else:
                    await req.fulfill(json=TRANSCRIBED if body['mode'] == 'transcribe' else IMPROVED)
            else:
                await req.continue_()
        await context.route('**/*', route)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        voice = page.locator('#voice-notes')
        record = voice.get_by_role('button', name='Gravar lembrete')

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
        await voice.get_by_role('button', name='Parar e transcrever').click()
        await expect(voice.locator('#voice-text')).to_have_value(TRANSCRIBED['text'])
        await expect(voice.locator('#voice-title')).to_have_value(TRANSCRIBED['title'])
        sent = state['requests'][-1]
        assert sent['mode'] == 'transcribe' and sent['mimeType'].startswith('audio/') and len(sent['audio']) > 1000, {k: (v if k != 'audio' else len(v)) for k, v in sent.items()}
        assert (await voice.locator('audio').get_attribute('src')).startswith('blob:')
        print('PASS Stopping uploads the whole recording once and fills an editable title and text; the recording can be played back', flush=True)

        await voice.get_by_role('button', name='Melhorar com Gemini').click()
        await expect(voice.locator('#voice-text')).to_have_value(IMPROVED['text'])
        assert state['requests'][-1] == {'mode': 'improve', 'text': TRANSCRIBED['text']}
        await voice.get_by_role('button', name='Desfazer melhoria').click()
        await expect(voice.locator('#voice-text')).to_have_value(TRANSCRIBED['text'])
        await voice.get_by_role('button', name='Melhorar com Gemini').click()
        await expect(voice.locator('#voice-title')).to_have_value(IMPROVED['title'])
        print('PASS Melhorar com Gemini rewrites title and text and can be undone', flush=True)

        await page.evaluate("document.querySelector('#voice-notes')._old=1;document.querySelector('#voice-notes .voice-audio')._kept=1")
        await voice.locator('#voice-text').click()
        await voice.locator('#voice-text').press('End')
        await voice.locator('#voice-text').press_sequentially(' Extra')
        await page.evaluate("dispatchEvent(new CustomEvent('flow:cloud-remote-merged',{detail:{data:JSON.parse(localStorage.getItem('test-workspace'))}}))")
        kept = await page.evaluate("({redrawn:!document.querySelector('#voice-notes')._old,audio:document.querySelector('#voice-notes .voice-audio')._kept===1,focus:document.activeElement.id})")
        assert kept == {'redrawn': True, 'audio': True, 'focus': 'voice-text'}, kept
        await expect(voice.locator('#voice-text')).to_have_value(IMPROVED['text'] + ' Extra')
        await voice.locator('#voice-text').fill(IMPROVED['text'])
        print('PASS A background redraw keeps the playing recording, the typed text and the cursor', flush=True)

        await voice.get_by_role('button', name='Salvar na Entrada').click()
        await expect(record).to_be_visible()
        card = page.locator('[data-entry-card]').filter(has_text=IMPROVED['title'])
        await expect(card).to_be_visible()
        await expect(card).to_contain_text('Lembrete de voz')
        task = await page.evaluate("JSON.parse(localStorage.getItem('test-workspace')).tasks[0]")
        assert task['source'] == 'voice' and task['title'] == IMPROVED['title'] and task['description'] == IMPROVED['text'], task
        assert task['project'] == '' and task['dueDate'] == '' and task['status'] == 'todo'
        print('PASS Salvar na Entrada creates an unclassified entry marked as a voice reminder, ready to classify', flush=True)

        state['fail'] = True
        await record.click()
        await page.wait_for_timeout(1500)
        await voice.get_by_role('button', name='Parar e transcrever').click()
        await expect(voice.locator('.voice-error')).to_contain_text('Não foi possível transcrever')
        await expect(voice.get_by_role('button', name='Salvar na Entrada')).to_be_disabled()
        state['fail'] = False
        await voice.get_by_role('button', name='Transcrever de novo').click()
        await expect(voice.locator('#voice-text')).to_have_value(TRANSCRIBED['text'])
        await expect(voice.locator('.voice-error')).to_have_count(0)
        await voice.locator('#voice-text').fill('Texto digitado à mão')
        await expect(voice.get_by_role('button', name='Salvar na Entrada')).to_be_enabled()
        await voice.get_by_role('button', name='Descartar').click()
        await expect(record).to_be_visible()
        print('PASS A failed transcription keeps the recording for a retry; typed text can be saved; Descartar resets', flush=True)

        state['wav_only'] = True
        before = len(state['requests'])
        await record.click()
        await page.wait_for_timeout(2200)
        await voice.get_by_role('button', name='Parar e transcrever').click()
        await expect(voice.locator('#voice-text')).to_have_value(TRANSCRIBED['text'])
        await expect(voice.locator('.voice-error')).to_have_count(0)
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
        await voice.get_by_role('button', name='Descartar').click()
        print('PASS When Gemini refuses the browser audio format, the recording is resent once as 16 kHz mono WAV', flush=True)

        await page.set_viewport_size({'width': 390, 'height': 844})
        await record.click()
        await expect(voice.get_by_role('button', name='Parar e transcrever')).to_be_visible()
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await voice.get_by_role('button', name='Cancelar').click()
        print('PASS The recording controls fit a 390 px phone', flush=True)

        denied = await context.new_page()
        denied.on('pageerror', lambda error: errors.append(str(error)))
        await denied.add_init_script("navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))")
        await denied.goto(BASE)
        await denied.locator('#voice-notes').get_by_role('button', name='Gravar lembrete').click()
        await expect(denied.locator('#voice-notes .voice-error')).to_contain_text('O microfone está bloqueado')
        print('PASS A blocked microphone explains how to allow it', flush=True)
        assert not errors, errors
        await browser.close()

asyncio.run(run())
