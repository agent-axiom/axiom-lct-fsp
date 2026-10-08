// UI-only mocked API regression. Run a local OFF-mode dev server first; this
// test never enables real accounts/email or reaches a provider.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.env.FSP_TEST_URL||'http://127.0.0.1:5274';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[],actions=[];let reads=0,blockedExternalRequests=0,failAction=true;
const initialTime=Date.now();
let state={enabled:true,enrolled:true,emailEnabled:true,emailStatus:'retry',emailRetryAllowed:true,emailRetryAt:initialTime+60000,emailAttempts:1,user:{email:'alice@example.test',verified:false}};
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'Mock browser request did not complete in time');await new Promise(resolve=>setTimeout(resolve,10));}}
let release;let gate=new Promise(resolve=>{release=resolve;});
try{
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:initialTime});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==new URL(base).origin){blockedExternalRequests++;return route.abort();}
    if(url.pathname==='/api/account/state'){reads++;return route.fulfill({json:state});}
    if(url.pathname==='/api/account/action'){
      actions.push(route.request().postDataJSON());await gate;
      if(failAction)return route.abort('failed');
      state={...state,emailStatus:'sent',emailRetryAllowed:false};return route.fulfill({json:{emailStatus:'sent'}});
    }
    if(url.pathname.startsWith('/api/'))throw new Error('Unexpected unmocked API request');
    return route.continue();
  });
  await page.goto(base+'/account/verify');
  await page.getByText('Автоматического повтора нет.',{exact:false}).waitFor();
  const retry=page.getByRole('button',{name:'Повторить ту же попытку',exact:true});
  assert.equal(await retry.isDisabled(),true);await page.clock.fastForward(61000);assert.equal(await retry.isEnabled(),true);
  // Two immediate DOM clicks must become one action; requests remain locked.
  await retry.evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>document.querySelector('button')?.disabled);
  await until(()=>actions.length===1);
  assert.deepEqual(actions,[{action:'email-retry'}]);release();
  await page.getByRole('alert').waitFor();assert.equal(actions.length,1);assert.ok(reads>=2);
  const readBefore=reads;await page.getByRole('button',{name:'Обновить статус',exact:true}).click();
  await until(()=>reads>readBefore);assert.equal(actions.length,1);
  failAction=false;gate=Promise.resolve();await retry.click();await page.getByText('Письмо передано почтовому провайдеру',{exact:true}).waitFor();assert.equal(actions.length,2);assert.equal(await retry.count(),0);
  await page.getByRole('button',{name:'Запросить новое письмо',exact:true}).click();
  await page.getByText('Запрос сохранён.',{exact:true}).waitFor();assert.deepEqual(actions[2],{action:'email-request'});
  state={...state,emailStatus:'failed',emailAttempts:5};await page.getByRole('button',{name:'Обновить статус',exact:true}).click();await page.getByText('Попытка завершена без подтверждения доставки.',{exact:false}).waitFor();assert.equal(await retry.count(),0);
  state={...state,emailStatus:'blocked',emailEnabled:false};await page.getByRole('button',{name:'Обновить статус',exact:true}).click();await page.getByText('Отправка выключена оператором',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Запросить новое письмо',exact:true}).isDisabled(),true);
  state={...state,emailEnabled:true,emailStatus:'retry',emailRetryAllowed:true,emailRetryAt:initialTime+180000};await page.getByRole('button',{name:'Обновить статус',exact:true}).click();await retry.waitFor();
  mkdirSync('outputs',{recursive:true});await page.screenshot({path:'outputs/email-dispatch-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/email-dispatch-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'passed',actions:actions.map(a=>a.action),stateReads:reads,desktopAndMobile:true,blockedExternalRequests,pageErrors:errors}));
}finally{release();await browser.close();}
