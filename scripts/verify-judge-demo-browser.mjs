// Explicit opt-in browser QA. Use only an authorized test URL and a fresh
// synthetic guest context. Does not log in, send email or solve an assessment.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.FSP_TEST_URL;
if(!url)throw new Error('Set FSP_TEST_URL to the authorized demo test URL.');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const checks=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByText('Покажите, что умеете.',{exact:true}).waitFor();
 assert.equal(await page.locator('.demo-scenario').getAttribute('open'),'');checks.push('Visible guide; no login required');
 await page.getByRole('button',{name:'Открыть подбор',exact:true}).click();
 await page.getByRole('button',{name:'Backend · Python / SQL',exact:true}).click();
 await page.locator('.candidate-card').first().waitFor();
 assert.ok(await page.locator('.candidate-card').filter({hasText:'Демо-баллы: заданы'}).count());
 assert.equal(await page.locator('.candidate-card').filter({hasText:'Контакт скрыт до принятия'}).count(),await page.locator('.candidate-card').count());checks.push('Preset search returns marked synthetic scores with locked contacts');
 await page.getByRole('button',{name:'Проверить пробел: Kubernetes',exact:true}).click();await page.getByText('Не подтверждено для запроса: Kubernetes',{exact:true}).first().waitFor();checks.push('Missing requirement remains visible');
 await page.getByRole('button',{name:'Frontend · Middle',exact:true}).click();
 const card=page.locator('.candidate-card').first();await card.getByText('Frontend / Middle',{exact:true}).waitFor();const selected=await card.locator('h3').innerText();
 const offer=card.getByRole('button',{name:'Предложить работу',exact:true});await offer.click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await offer.evaluate(el=>document.activeElement===el),true);checks.push('Cancel offer restores keyboard focus');
 await offer.click();await page.getByRole('button',{name:'Отправить приглашение',exact:true}).evaluate(el=>{el.click();el.click();});await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.reload();await page.getByRole('button',{name:'Открыть приглашения кандидата',exact:true}).click();await page.getByText('Покажите, что умеете.',{exact:true}).waitFor();assert.equal(await page.locator('.rail .muted').innerText(),selected);assert.equal(await page.locator('.invite-card').count(),1);checks.push('Refresh retains offered candidate; repeated submit creates one offer');
 await page.getByRole('button',{name:'Принять и открыть контакт',exact:true}).click();await page.getByText('Принято',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Работодатель',exact:true}).click();await page.getByRole('tab',{name:/Приглашения/}).click();await page.locator('.unlocked').waitFor();checks.push('Candidate acceptance unlocks invited employer contact');
 await page.getByRole('button',{name:'Кандидат',exact:true}).click();await page.getByRole('tab',{name:'Мой профиль',exact:true}).click();
 const pdfHref=await page.getByRole('link',{name:'Скачать PDF',exact:true}).getAttribute('href');const pdf=await context.request.get(new URL(pdfHref,url).href);assert.equal(pdf.status(),200);assert.match(pdf.headers()['content-type'],/application\/pdf/);assert.ok((await pdf.body()).subarray(0,5).toString().startsWith('%PDF'));checks.push('Own PDF available');
 await page.getByRole('link',{name:'Статус реальных аккаунтов',exact:true}).click();await page.goBack();await page.getByText('Покажите, что умеете.',{exact:true}).waitFor();assert.equal(await page.locator('.rail .muted').innerText(),selected);checks.push('Back navigation returns to authoritative selected actor');
 await page.getByRole('tab',{name:'Опрос и тест',exact:true}).click();await page.getByRole('button',{name:'Начать тест',exact:true}).click();
 const answer=page.locator('.question').first().locator('input,select');await answer.waitFor();const isSelect=await answer.evaluate(el=>el.tagName==='SELECT');if(isSelect)await answer.selectOption({index:1});else await answer.fill('demo');const entered=await answer.inputValue();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Работодатель',exact:true}).click();assert.equal(await answer.inputValue(),entered);assert.equal(await page.locator('.rail .muted').innerText(),selected);checks.push('Cancel dirty-answer role switch preserves answers and actor');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Работодатель',exact:true}).click();await page.getByText('Найдите своего специалиста.',{exact:true}).waitFor();await page.getByRole('button',{name:'Кандидат',exact:true}).click();await page.getByRole('tab',{name:'Опрос и тест',exact:true}).click();await page.locator('.question').first().waitFor();assert.equal(await page.locator('.question').first().locator('input,select').inputValue(),'');checks.push('Approved switch clears answers as disclosed; unfinished attempt remains');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('No mobile horizontal overflow');
 await page.getByRole('button',{name:'Начать сначала',exact:true}).click();await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.locator('.rail .muted').innerText(),selected);
 await page.getByRole('button',{name:'Начать сначала',exact:true}).click();await page.getByRole('button',{name:'Сбросить демо',exact:true}).click();await page.getByText('Алексей · демо',{exact:true}).waitFor();await page.getByRole('button',{name:'Открыть приглашения кандидата',exact:true}).click();await page.getByText('Приглашений пока нет',{exact:true}).waitFor();checks.push('Reset cancellation preserves data; confirmed reset restores fresh guest');
 console.log(JSON.stringify({checks,errors,scope:'Synthetic fresh guest browser; no email, real accounts or assessment validity claim'},null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();}
