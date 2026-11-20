import {test,expect,type Page} from '@playwright/test';
import {mockOverview} from './fixtures/acceleratorOverview';

async function resident(page:Page) {
 await page.addInitScript(()=>{localStorage.setItem('vi_auth_state','cookie-session');localStorage.setItem('pitchy_cookie_consent_v2',JSON.stringify({choice:'necessary',updatedAt:new Date().toISOString()}));});
 await page.route('**/me',r=>r.fulfill({json:{id:18,name:'Анна Иванова',email:null,is_admin:false,is_active:true,email_verified:true}}));
 await page.route('**/api/accelerators',r=>r.fulfill({json:[{id:7,name:'Акселератор',access_role:'resident',status:'active'}]}));
 await page.route('**/api/accelerators/me/memberships',r=>r.fulfill({json:{memberships:[{membership_id:101,status:'enrolled',accelerator:{id:7,name:'Акселератор'},cohort:{id:12,name:'Поток',status:'active',timezone:'Europe/Moscow'},modules:{attendance:true,program_progress:false}}],effective_quotas:{}}}));
 await page.route('**/api/accelerators/memberships/101/dashboard-live',r=>r.fulfill({json:{enabled:false}}));
 await page.route('**/api/accelerators/memberships/101/today',r=>r.fulfill({status:503,json:{detail:'Нет данных'}}));
 await page.route('**/api/accelerators/notifications**',r=>r.fulfill({json:{items:[],count:0,unread_count:0,next_cursor:null}}));
 await page.route('**/api/accelerators/memberships/101/events',r=>r.fulfill({json:[{id:51,title:'Целевая аудитория',status:'completed',starts_at:'2026-11-09T15:00:00Z',ends_at:'2026-11-09T16:30:00Z',event_format:'online',homework_links:[],post_materials:[],attendance:{status:'absent'}}]}));
}
for(const photo of [false,true])test(`participant submits correction ${photo?'with optional proof':'without a file'}`,async({page})=>{
 await resident(page);if(photo)await page.setViewportSize({width:390,height:844});
 const items:unknown[]=[];let submitted=false;
 await page.route('**/api/accelerators/memberships/101/attendance-corrections',r=>r.fulfill({json:{full_name:'Анна Иванова',items}}));
 await page.route('**/api/accelerators/memberships/101/events/51/attendance-corrections/files',r=>r.fulfill({json:{name:'proof.png',url:'/api/accelerators/files/proof',mime_type:'image/png',size_bytes:128}}));
 await page.route('**/api/accelerators/memberships/101/events/51/attendance-corrections',r=>{
  const body=r.request().postDataJSON();expect(body).toMatchObject({full_name:'Анна Иванова',was_present:true,description:'Была на встрече, отметка отсутствует',attachments:photo?['/api/accelerators/files/proof']:[]});
  submitted=true;const item={id:1,event_id:51,membership_id:101,...body,status:'pending',created_at:new Date().toISOString()};items.push(item);return r.fulfill({status:201,json:item});
 });
 await page.goto('/accelerator/my/101');
 if(photo)await page.getByRole('button',{name:'Меню участника',exact:true}).click();
 await page.getByRole('button',{name:'Расписание и мероприятия',exact:true}).click();
 const trigger=page.getByRole('button',{name:'Корректировка посещаемости: Целевая аудитория',exact:true});await trigger.click();
 const dialog=page.getByRole('dialog',{name:'Заявка на корректировку посещаемости'});await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel('ФИО',{exact:true})).toHaveValue('Анна Иванова');
 await dialog.getByRole('radio',{name:'Да',exact:true}).check();await dialog.getByLabel('Опишите ситуацию').fill('Была на встрече, отметка отсутствует');
 if(photo){await dialog.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('89504e470d0a1a0a','hex')});await expect(dialog.getByText('proof.png',{exact:true})).toBeVisible();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(photo)await page.screenshot({path:'../output/attendance-correction-modal-mobile.png'});
 await dialog.getByRole('button',{name:'Отправить на проверку'}).click();await expect(dialog).toHaveCount(0);expect(submitted).toBe(true);
 await expect(page.getByText('Заявка на проверке',{exact:true})).toBeVisible();await expect(trigger).toBeDisabled();
});

test('organizer opens dedicated queue from overview and approves a correction',async({page})=>{
 await mockOverview(page);
 await page.route('**/api/accelerators/cohorts/12/overview-summary',r=>r.fulfill({json:{participants:3,at_risk:1,without_tracker:0,attendance_corrections_pending:1}}));
 let approved=false;
 const item={id:1,event_id:51,membership_id:101,full_name:'Анна Иванова',account_name:'Анна',event_title:'Целевая аудитория',event_starts_at:'2026-11-09T15:00:00Z',was_present:true,description:'Была на мероприятии',attachments:[],status:'pending',created_at:'2026-11-20T10:00:00Z'};
 await page.route('**/api/accelerators/cohorts/12/attendance-corrections?**',r=>r.fulfill({json:{total:approved?0:1,pending:approved?0:1,team_attendance:true,items:approved?[]:[item]}}));
 await page.route('**/api/accelerators/attendance-corrections/1',r=>{expect(r.request().postDataJSON()).toMatchObject({decision:'approved',comment:'Подтверждено по записи'});approved=true;return r.fulfill({json:{...item,status:'approved'}});});
 await page.goto('/accelerator');
 const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Заявки на корректировку посещаемости',exact:true})});
 await panel.getByRole('button',{name:'Посмотреть',exact:false}).click();
 await expect(page).toHaveURL(/section=attendance_corrections/);
 await expect(page.getByRole('heading',{name:'Заявки на корректировку посещаемости',exact:true})).toBeVisible();
 await expect(page.getByText('Командный учёт:',{exact:false})).toBeVisible();
 await page.getByLabel('Комментарий участнику (необязательно)').fill('Подтверждено по записи');
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
 await expect(page.getByText('Заявок с выбранным статусом нет.')).toBeVisible();expect(approved).toBe(true);
});
