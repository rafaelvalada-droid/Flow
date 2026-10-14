"""Browser expiration/reopening checks using mocked Google and Supabase services."""
import asyncio
import json
import os
from datetime import date, timedelta
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright, expect

BASE=os.environ.get('FLOW_TEST_URL','http://127.0.0.1:3000')
AUTH='https://refresh-test.supabase.co'
USER='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
SESSION='flow.auth.session.v1'

async def until(page, expression, timeout=15):
    """page.wait_for_function compiles strings with eval, which the production CSP blocks; poll with evaluate()."""
    deadline, last = asyncio.get_running_loop().time() + timeout, None
    while True:
        try:
            if await page.evaluate(expression):
                return
        except Exception as error:  # navigation in progress or a not-yet-defined value
            last = error
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f'Timed out waiting for {expression} ({last})')
        await asyncio.sleep(0.05)


async def main():
    state={'renewals':0,'token':'google-old','reject':None,'temporary_failure':False,'google_calls':0}
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=await browser.new_context(timezone_id='America/Sao_Paulo')
        session={'project':AUTH,'user':{'id':USER,'email':'user@example.test'},'access_token':'test-supabase-access-token-long-enough','refresh_token':'test-supabase-refresh','expires_at':2100000000,'provider_token':'google-old','provider_refresh_token':'test-google-refresh-browser','google_access_expires_at':1,'gmailConnected':True,'calendarConnected':True}
        await context.add_init_script('if(!localStorage.getItem('+json.dumps(SESSION)+'))localStorage.setItem('+json.dumps(SESSION)+','+json.dumps(json.dumps(session))+');')
        async def route(r):
            req=r.request;url=urlsplit(req.url)
            async def reply(data,status=200):await r.fulfill(status=status,content_type='application/json',body=json.dumps(data))
            if url.path=='/api/auth-config':return await reply({'configured':True,'url':AUTH,'key':'sb_publishable_test','googleRefreshConfigured':True})
            if url.path=='/api/google-token':
                assert req.headers.get('authorization')=='Bearer test-supabase-access-token-long-enough'
                assert req.post_data_json=={'refreshToken':'test-google-refresh-browser'}
                state['renewals']+=1
                await asyncio.sleep(.05)
                if state['temporary_failure']:return await reply({'code':'GOOGLE_REFRESH_NOT_CONFIGURED','error':'Renovação indisponível temporariamente'},503)
                state['token']='google-renewed-'+str(state['renewals'])
                return await reply({'accessToken':state['token'],'expiresIn':3600})
            if url.hostname=='refresh-test.supabase.co':
                assert req.headers.get('authorization')=='Bearer test-supabase-access-token-long-enough'
                if url.path=='/auth/v1/user':return await reply(session['user'])
                if url.path=='/rest/v1/flow_workspaces':return await reply([{'revision':1,'data':{'version':1,'areaCatalogVersion':5,'projects':[],'tasks':[],'preferences':{}}}])
                if url.path=='/rest/v1/rpc/flow_save_workspace':return await reply({'revision':2})
                raise AssertionError('Unexpected authenticated request '+url.path)
            if url.hostname in ['gmail.googleapis.com','www.googleapis.com']:
                state['google_calls']+=1
                if req.headers.get('authorization')=='Bearer '+str(state['reject']):return await reply({'error':{'message':'Expired access'}},401)
                assert req.headers.get('authorization')=='Bearer '+state['token']
                if url.hostname=='gmail.googleapis.com':
                    if url.path.endswith('/profile'):return await reply({'emailAddress':'user@example.test','historyId':'100'})
                    if url.path.endswith('/threads'):return await reply({'threads':[]})
                    raise AssertionError('Unexpected Gmail request '+url.path)
                start=parse_qs(url.query)['timeMin'][0][:10]
                end=(date.fromisoformat(start)+timedelta(days=1)).isoformat()
                return await reply({'items':[{'id':'meeting','summary':'Reunião conservada','start':{'date':start},'end':{'date':end}}]})
            return await r.continue_()
        await context.route('**/*',route)
        errors=[]
        page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(BASE)
        await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        await until(page, 'FlowGmailReview.info().loading===false && FlowCloud.gmailToken().startsWith("google-renewed")')
        assert state['renewals']==1
        assert await page.locator('#google-login').count()==0
        print('PASS Expired Google access renews on startup without requesting consent',flush=True)
        await page.locator('[data-page="agenda"]').click()
        await expect(page.get_by_text('Reunião conservada')).to_be_visible()
        assert state['renewals']==1
        await page.close()
        page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(BASE);await expect(page.locator('.page-head h1')).to_have_text('Entrada')
        await until(page, 'FlowGmailReview.info().loading===false')
        assert state['renewals']==1
        print('PASS Gmail and Agenda reuse the saved access after closing and reopening the app',flush=True)
        await page.locator('[data-page="agenda"]').click();await expect(page.get_by_text('Reunião conservada')).to_be_visible()
        state['reject']=state['token'];before=state['renewals']
        await page.evaluate('async()=>{await Promise.all([FlowGmailReview.refresh(),FlowCalendar.refresh()]);}')
        assert state['renewals']==before+1
        assert await page.evaluate('!!FlowCloud.gmailToken()&&!!FlowCloud.calendarToken()')
        assert await page.evaluate('FlowGmailReview.info().error')==''
        assert await page.evaluate('FlowCalendar.info().readError')==''
        print('PASS Concurrent Gmail and Agenda 401 responses share one renewal and both retry successfully',flush=True)
        state['reject']=state['token'];state['temporary_failure']=True
        await page.evaluate('async()=>{await Promise.all([FlowGmailReview.refresh(),FlowCalendar.refresh()]);}')
        stored=await page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',SESSION)
        assert stored['gmailConnected'] and stored['calendarConnected']
        assert stored['provider_refresh_token']=='test-google-refresh-browser'
        state['temporary_failure']=False
        await page.evaluate('async()=>{await Promise.all([FlowGmailReview.refresh(),FlowCalendar.refresh()]);}')
        assert await page.evaluate('FlowGmailReview.info().error')==''
        assert await page.evaluate('FlowCalendar.info().readError')==''
        assert not errors,errors
        print('PASS Temporary renewal failures preserve connections and recover without reauthorization',flush=True)
        await browser.close()
asyncio.run(main())
