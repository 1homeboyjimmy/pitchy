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

test('SSE coalesces bursts and refreshes reports after navigation',async({page})=>{
 const count=await setup(page);await page.goto('/accelerator');
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await expect.poll(count).toBe(2);const before=count();
 await page.evaluate(()=>{for(let i=0;i<20;i++)window.dispatchEvent(new CustomEvent('dashboard-test-event',{detail:'changed'}));});
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await expect.poll(count).toBe(before+1);
 await page.waitForTimeout(450);expect(count()).toBe(before+1);
 let reports=0;
 await page.route('**/api/accelerators/cohorts/12/report', r=>{
  reports++;
  return r.fulfill({json:{cohort_id:12,access_role:'organizer',summary:{residents:0},rows:[]}});
 });
 await page.getByRole('button',{name:'Участники: 3',exact:true}).click();
 await expect.poll(()=>reports).toBeGreaterThan(0);
 await page.waitForTimeout(450);
 const reportCount = reports;
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__liveSources:Array<{closed:boolean}>}).__liveSources.filter(s=>!s.closed).length)).toBe(1);
 await emit(page,'changed');
 await expect.poll(()=>reports).toBe(reportCount + 1);
 await page.goto('/login');
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

test('tracking receives live changes without resetting the search', async ({ page }) => {
 await setup(page);
 let requests = 0;
 await page.route('**/api/accelerators/cohorts/12/tracking-dashboard', r => {
  requests++;
  return r.fulfill({json:{summary:{residents:0,open_signals:0,high_signals:0,overdue_signals:0,no_checkin:0},rows:[],signals:[]}});
 });
 await page.goto('/accelerator');
 await expect(page.getByRole('heading',{name:'Посещаемость команд',exact:true})).toBeVisible();
 await page.getByRole('button', {name:'Открыть',exact:true}).click();
 await page.getByRole('button', {name:/Все участники/}).click();
 const search = page.getByPlaceholder('Поиск по имени или email');
 await search.fill('Сохранённый поиск');
 await page.waitForTimeout(450);
 const before = requests;
 await emit(page,'changed');
 await expect.poll(() => requests).toBe(before + 1);
 await expect(search).toHaveValue('Сохранённый поиск');
});
