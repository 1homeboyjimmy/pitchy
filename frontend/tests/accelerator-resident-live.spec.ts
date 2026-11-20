import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
 await page.addInitScript(() => {
  localStorage.setItem('vi_auth_state','cookie-session');
  localStorage.setItem('pitchy_cookie_consent_v2',JSON.stringify({choice:'necessary',updatedAt:new Date().toISOString()}));
  class Source extends EventTarget {
   closed = false; onerror: ((event: Event) => void) | null = null;
   constructor(public url: string) {
    super();
    window.addEventListener('resident-test-update', () => {
     if (!this.closed) this.dispatchEvent(new MessageEvent('changed',{data:'{"revision":"1:2"}'}));
    });
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('ready',{data:'{"revision":"1:1"}'})));
   }
   close() { this.closed = true; }
  }
  Object.defineProperty(window,'EventSource',{value:Source});
 });
 await page.route('**/me',r=>r.fulfill({json:{id:18,name:'Анна',email:null,is_admin:false,is_active:true,email_verified:true}}));
 await page.route('**/api/accelerators',r=>r.fulfill({json:[{id:7,name:'Акселератор',status:'active',access_role:'resident'}]}));
 await page.route('**/api/accelerators/me/memberships',r=>r.fulfill({json:{memberships:[{membership_id:101,status:'enrolled',accelerator:{id:7,name:'Акселератор',status:'active'},cohort:{id:12,name:'Основной поток',status:'active',timezone:'Europe/Moscow'},project:null,modules:{program:true,homework:true,attendance:true}}],effective_quotas:{}}}));
 await page.route('**/api/accelerators/notifications**',r=>r.fulfill({json:{items:[],count:0,unread_count:0,next_cursor:null}}));
 await page.route('**/api/accelerators/memberships/101/today',r=>r.fulfill({status:503,json:{detail:'Нет данных'}}));
 await page.route('**/api/accelerators/memberships/101/dashboard-live',r=>r.fulfill({json:{enabled:true}}));
}
async function changed(page: Page) {
 await page.evaluate(() => window.dispatchEvent(new Event('resident-test-update')));
}

test('participant calendar receives changed events without leaving the page',async({page})=>{
 await setup(page);
 let title='Первая лекция';let calls=0;
 await page.route('**/api/accelerators/memberships/101/events',r=>{
  calls++;
  return r.fulfill({json:[{id:51,title,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),status:'published',event_format:'online',event_type:'lecture',homework_links:[],post_materials:[],timezone:'Europe/Moscow'}]});
 });
 await page.goto('/accelerator/my/101');
 await page.getByRole('button',{name:'Программа',exact:true}).click();
 await page.getByRole('button',{name:'Расписание и мероприятия',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Первая лекция',exact:true})).toBeVisible();
 await page.waitForTimeout(500);const before=calls;title='Обновлённая лекция';
 await changed(page);
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 expect(calls).toBe(before+1);
 await expect(page).toHaveURL(/accelerator\/my\/101/);
});

test('participant homework draft survives an automatic update',async({page})=>{
 await setup(page);
 let calls=0;
 await page.route('**/api/accelerators/memberships/101/homework',r=>{
  calls++;
  return r.fulfill({json:[{id:41,title:'Проверка гипотезы',description:'Опишите результат',assignment_type:'text_files',submission_mode:'individual',can_submit:true,display_status:'not_started',workspace_submission:null,submission:null,pitchy_enabled:false,pitchy_tools:[],quiz_questions:[],allow_resubmit:true}]});
 });
 await page.goto('/accelerator/my/101');
 await page.getByRole('button',{name:'Программа',exact:true}).click();
 await page.getByRole('button',{name:'Домашние задания',exact:true}).click();
 const draft=page.locator('#resident-homework-41 textarea');
 await draft.fill('Мой незавершённый ответ');
 await page.waitForTimeout(500);const before=calls;
 await changed(page);
 await expect.poll(()=>calls).toBe(before+1);
 await expect(draft).toHaveValue('Мой незавершённый ответ');
});
