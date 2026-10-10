// Run only against an authorized synthetic test URL. No offer is submitted.
// Short CSS viewports are regression proxies, not proof of actual browser zoom.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.FSP_TEST_URL;if(!url)throw Error('Set FSP_TEST_URL to the authorized synthetic demo URL.');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const results=[];
try{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(url);
 await page.getByRole('button',{name:'Открыть подбор',exact:true}).click();await page.getByRole('button',{name:'Backend · Python / SQL',exact:true}).click();
 const trigger=page.locator('.candidate-card').filter({hasText:'Ольга · демо'}).getByRole('button',{name:'Предложить работу',exact:true});await trigger.waitFor();
 for(const viewport of [{width:590,height:378},{width:388,height:252},{width:390,height:844},{width:1440,height:900}]){
  await page.setViewportSize(viewport);await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.waitForTimeout(250);
  const box=await dialog.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height+1,JSON.stringify({viewport,box}));
  const layout=await dialog.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));assert.equal(layout.overflow,'auto');
  let sawSubmit=false;
  for(let i=0;i<12;i++){
   await page.keyboard.press('Tab');
   const focused=await dialog.evaluate(el=>{const active=document.activeElement,rect=active.getBoundingClientRect(),outer=el.getBoundingClientRect();return {inside:el.contains(active),visible:rect.top>=outer.top&&rect.bottom<=outer.bottom,text:active.textContent,scrollTop:el.scrollTop};});
   assert.equal(focused.inside,true);assert.equal(focused.visible,true,JSON.stringify({viewport,focused}));if(focused.text==='Отправить приглашение')sawSubmit=true;
  }
  assert.equal(sawSubmit,true);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);results.push({viewport,...layout,tabCycleVisible:true,escapeRestoresTrigger:true});
 }
 console.log(JSON.stringify({results,scope:'Synthetic offer modal, no submit. Actual Chrome 200%/300% zoom requires separate supported-browser confirmation.'},null,2));
}finally{await browser.close();}
