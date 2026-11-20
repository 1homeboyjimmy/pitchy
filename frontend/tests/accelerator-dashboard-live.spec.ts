import { test, expect, type Page } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';

async function setup(page: Page) {
 await mockOverview(page);
 await page.route('**/api/accelerators/cohorts/12/dashboard-live',r=>r.fulfill({json:{enabled:true}}));
 await page.addInitScript(()=>{
  const state=window as unknown as {__liveSources:Array<{url:string;closed:boolean}>;__liveFailure:boolean};
  state.__liveSources=[];state.__liveFailure=false;
  class Source extends EventTarget {
   closed=false;onerror:((e:Event)=>void)|null=null;
   constructor(public url:string){
    super();state.__liveSources.push(this);
    window.addEventListener('dashboard-test-event',(e)=>{
     if(this.closed)return;
     const kind=(e as CustomEvent).detail;
     if(kind==='error')this.onerror?.(new Event('error'));
     else this.dispatchEvent(new MessageEvent(kind,{data:'{"revision":"1:1"}'}));
    });
    queueMicrotask(()=>{if(!this.closed)this.dispatchEvent(new MessageEvent(state.__liveFailure?'fallback':'ready',{data:'{"revision":"1:0"}'}));});
   }
   close(){this.closed=true;}
  }
  Object.defineProperty(window,'EventSource',{value:Source});
 });
 let requests=0;
 await page.route('**/api/accelerators/cohorts/12/attendance-insights',r=>{
  requests++;
  return r.fulfill({json:{scope:'team',basis:'past',past_events:1,percent:50,teams:1,distribution:{normal:1,below50:0,zero:0,no_data:0},participants:{normal:1,below50:0,zero:0,no_data:0},top_teams:[],by_course:[],by_direction:[],by_track:[],events:[],visit_distribution:[{visits:1,participants:1}]}});
 });
 return ()=>requests;
}
async function emit(page:Page,kind:string){await page.evaluate(kind=>window.dispatchEvent(new CustomEvent('dashboard-test-event',{detail:kind})),kind);}

test('SSE coalesces bursts without hiding charts and closes on navigation',async({page})=>{
 const count=await setup(page);await page.goto('/accelerator');
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await expect.poll(count).toBe(2);const before=count();
 await page.evaluate(()=>{for(let i=0;i<20;i++)window.dispatchEvent(new CustomEvent('dashboard-test-event',{detail:'changed'}));});
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await expect.poll(count).toBe(before+1);
 await page.waitForTimeout(450);expect(count()).toBe(before+1);
 await page.getByRole('button',{name:'Участники: 3',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__liveSources:Array<{closed:boolean}>}).__liveSources.every(s=>s.closed))).toBe(true);
});

test('SSE outage polls, reconnects and stops on lost access',async({page})=>{
 await page.clock.install();const count=await setup(page);await page.goto('/accelerator');
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await page.clock.runFor(400);await expect.poll(count).toBe(2);
 await page.evaluate(()=>(window as unknown as {__liveFailure:boolean}).__liveFailure=true);
 await emit(page,'error');await page.clock.runFor(400);const before=count();
 await page.clock.runFor(31_000);await expect.poll(count).toBeGreaterThan(before);
 expect(count()).toBeLessThanOrEqual(before+2);
 await page.evaluate(()=>(window as unknown as {__liveFailure:boolean}).__liveFailure=false);
 await page.clock.runFor(32_000);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__liveSources:Array<{closed:boolean}>}).__liveSources.some(s=>!s.closed))).toBe(true);
 await emit(page,'forbidden');await page.clock.runFor(400);const stopped=count();
 await page.clock.runFor(61_000);expect(count()).toBe(stopped);
});
