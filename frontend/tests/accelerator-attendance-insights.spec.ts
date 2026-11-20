import { test, expect, type Page } from '@playwright/test';
import { mockOverview, analytics } from './fixtures/acceleratorOverview';
async function setup(page: Page) {
 await mockOverview(page);
 await page.route('**/api/accelerators/cohorts/12/program-config',r=>r.fulfill({json:{cohort_id:12,version:2,modules:{applications:true,program:true,attendance:true,progress_tracking:true,matchmaking:true,trackers:false,homework:false},locked_modules:{}}}));
 await page.route('**/api/accelerators/cohorts/12/analytics',r=>r.fulfill({json:{...analytics,program:{published_stages:0,completion_percent:0,current_stage:null}}}));
 await page.route('**/api/accelerators/cohorts/12/attendance-insights',r=>r.fulfill({json:{scope:'team',basis:'planned',past_events:7,percent:35,teams:3,distribution:{normal:1,below50:1,zero:1,no_data:0},participants:{zero:40,below50:1,normal:1,no_data:1},top_teams:[{id:11,name:'Команда лидеров',members:2,percent:90,track:'Технологический',present:9,total:10}],by_course:[{label:'БАК · 1 курс',participants:20,percent:40,present:8,total:20}],by_direction:[{label:'Бакалавриат',participants:42,percent:35,present:14,total:40}],by_track:[],visit_distribution:[{visits:0,participants:40},{visits:1,participants:1},{visits:2,participants:1}],events:[{id:51,title:'Воркшоп по CustDev',present:2,total:3,percent:66.7}]}}));
 const rows=Array.from({length:43},(_,i)=>({membership_id:100+i,name:`Участник ${String(i).padStart(2,'0')}`,email:`resident${i}@example.test`,status:'enrolled',program:{enabled:false,percent:0},attendance:{present:i===40?4:i===41?5:0,total:10},open_tasks:0,risk:{level:i<41?'red':'green',reasons:i<41?['Низкая посещаемость']:[],attendance_percent:i===40?40:i===41?50:0,attendance_past_events:i===42?0:7}}));
 await page.route('**/api/accelerators/cohorts/12/tracking-dashboard',r=>r.fulfill({json:{summary:{residents:43,at_risk:41,open_signals:41,overdue_signals:0},rows,signals:[]}}));
 const team=(id:number,name:string,percent:number,linked?:number)=>({id,name,status:'active',max_members:5,recruiting_open:true,project:null,tracker:null,owner_membership_id:100,can_manage:false,attendance_percent:percent,attendance_team_id:linked,members:[],pending_invitations:[]});
 await page.route('**/api/accelerators/cohorts/12/teams',r=>r.fulfill({json:{teams:[team(11,'Команда лидеров',90),team(12,'Команда без посещений',0),team(13,'Связанный проект',0,12)]}}));
}
test('attendance drilldowns preserve threshold pagination and search',async({page})=>{
 await setup(page);await page.goto('/accelerator');
 await page.getByRole('button',{name:/Участников без посещений/}).click();
 await expect(page.getByRole('combobox',{name:'Посещаемость участников'})).toHaveValue('zero');
 const pages=page.getByRole('navigation',{name:'Страницы результатов'});
 await expect(pages).toContainText('1–20 из 40');await page.getByRole('button',{name:'Следующая страница'}).click();await expect(pages).toContainText('21–40 из 40');
 await page.getByPlaceholder('Поиск по имени или email').fill('resident39@');await expect(pages).toContainText('1–1 из 1');
 await page.getByRole('navigation',{name:'Разделы акселератора'}).getByRole('button',{name:'Обзор',exact:true}).click();
 await page.getByRole('button',{name:/Участников ниже 50%/}).click();await expect(page.getByRole('combobox',{name:'Посещаемость участников'})).toHaveValue('below50');await expect(page.getByPlaceholder('Поиск по имени или email')).toHaveValue('');await expect(pages).toContainText('1–20 из 41');
 await page.getByRole('combobox',{name:'Участников на странице'}).selectOption('60');await expect(page.getByText('Участник 40',{exact:true})).toBeVisible();await expect(page.getByText('Участник 41',{exact:true})).toHaveCount(0);await expect(page.getByText('Участник 42',{exact:true})).toHaveCount(0);
});
test('zero teams exclude linked projects and tracker controls',async({page})=>{
 await setup(page);await page.goto('/accelerator');await expect(page.getByRole('button',{name:/Трекеры:/})).toHaveCount(0);await page.getByRole('button',{name:/Команды без посещений · 1/}).click();await expect(page.getByRole('combobox',{name:'Посещаемость команд'})).toHaveValue('zero');await expect(page.getByText('Команда без посещений',{exact:true})).toBeVisible();await expect(page.getByText('Связанный проект',{exact:true})).toHaveCount(0);await expect(page.getByText('Команда лидеров',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Трекеры',exact:true})).toHaveCount(0);
});
test('comparisons fit mobile and delivery warnings stay in notifications',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});let calls=0;
 await page.route('**/api/accelerators/cohorts/12/notification-health',r=>{calls++;return r.fulfill({json:{failed:4,stuck:2,action_url:'/accelerator?section=operations'}})});
 await page.route('**/api/accelerators/notifications?**',r=>r.fulfill({json:{items:[],next_cursor:null}}));await page.route('**/api/accelerators/notifications/preferences',r=>r.fulfill({json:{email_enabled:true}}));
 await page.goto('/accelerator');await expect(page.getByRole('heading',{name:'Кто посещает программу'})).toBeVisible();await expect(page.getByText('БАК · 1 курс')).toBeVisible();await expect(page.getByText('Команд в потоке',{exact:true})).toHaveCount(0);await expect(page.getByText('Мероприятий проведено',{exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Сколько мероприятий посетили участники'})).toBeVisible();await expect(page.getByText(/Проценты рассчитаны|Командный учёт/)).toHaveCount(0);await page.getByRole('button',{name:'По уровню образования',exact:true}).click();await expect(page.getByText('Бакалавриат',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:/институт/i})).toHaveCount(0);expect(calls).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../output/accelerator-overview/attendance-mobile.png',fullPage:true});await page.getByRole('button',{name:/Уведомления/}).click();await expect.poll(()=>calls).toBe(1);await expect(page.getByText("Не доставлено после повторных попыток: 4")).toBeVisible();
});

test('desktop charts and team ranking work in dark theme',async({page})=>{
 await setup(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/accelerator');await expect(page.getByRole('heading',{name:'Топ-5 команд по посещаемости'})).toBeVisible();await page.getByRole('button',{name:'Переключить тему'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../output/accelerator-overview/attendance-desktop.png',fullPage:true,animations:'disabled'});await page.getByRole('button',{name:/1 Команда лидеров 90%/}).click();await expect(page.getByRole('dialog')).toBeVisible();
});
