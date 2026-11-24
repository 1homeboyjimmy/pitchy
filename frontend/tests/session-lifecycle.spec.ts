import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
async function setup(page: Page) {
 await page.route('http://session.test/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/auth-test.js'||p==='/api-test.js') {
   const source=fs.readFileSync(path.resolve('lib',p==='/auth-test.js'?'auth.ts':'api.ts'),'utf8').replace('from "./auth"','from "/auth-test.js"');
   await r.fulfill({contentType:'text/javascript',body:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText});
  } else await r.fulfill({contentType:'text/html',body:'<html><body>Session test</body></html>'});
 });
 await page.goto('http://session.test/');
 await page.evaluate(async()=>{const a='/auth-test.js',b='/api-test.js';(window as any).t={a:await import(a),api:await import(b)};});
}
test('cookie restores missing marker; parallel checks share a request',async({page})=>{
 await setup(page);let calls=0;await page.route('**/auth/session',async r=>{calls++;await r.fulfill({json:{authenticated:true}});});
 const x=await page.evaluate(async()=>{const a=(window as any).t.a;await Promise.all([a.ensureSession(),a.ensureSession()]);return [a.getToken(),a.getAuthStatus()];});
 expect(x).toEqual(['cookie-session','authenticated']);expect(calls).toBe(1);
});
test('server outage preserves login; retry recovers',async({page})=>{
 await setup(page);await page.route('**/auth/session',r=>r.fulfill({status:503,json:{detail:'offline'}}));
 const x=await page.evaluate(async()=>{const a=(window as any).t.a;a.setToken('secret');await a.ensureSession(true);return [a.getToken(),a.getAuthStatus(),a.wasSessionValidated(),localStorage.getItem('vi_auth_state')];});
 expect(x).toEqual(['cookie-session','error',true,'cookie-session']);
 await page.route('**/auth/session',r=>r.fulfill({json:{authenticated:true}}));
 expect(await page.evaluate(async()=>await (window as any).t.a.ensureSession(true))).toBe(true);
});
test('late bootstrap 401 cannot erase newer login',async({page})=>{
 await setup(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/auth/session',async r=>{await gate;await r.fulfill({status:401,json:{detail:'expired'}});});
 await page.evaluate(()=>{(window as any).pending=(window as any).t.a.ensureSession(true);});
 await page.evaluate(()=>(window as any).t.a.setToken('new-login'));release();
 expect(await page.evaluate(async()=>{await (window as any).pending;return (window as any).t.a.getAuthStatus();})).toBe('authenticated');
});
test('late API 401 retries after new login without logout',async({page})=>{
 await setup(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);let calls=0;
 await page.route('**/protected',async r=>{calls++;if(calls===1){await gate;await r.fulfill({status:401,json:{detail:'expired'}});}else await r.fulfill({json:{ok:true}});});
 await page.evaluate(()=>{const t=(window as any).t;t.a.setToken('old');(window as any).pending=t.api.getAuthJson('/protected','cookie-session');});
 await page.evaluate(()=>(window as any).t.a.setToken('new'));release();
 expect(await page.evaluate(async()=>await (window as any).pending)).toEqual({ok:true});expect(calls).toBe(2);
 expect(await page.evaluate(()=>(window as any).t.a.getAuthStatus())).toBe('authenticated');
});
test('valid session recovers API 401 and server errors never logout',async({page})=>{
 await setup(page);let calls=0;await page.route('**/auth/session',r=>r.fulfill({json:{authenticated:true}}));
 await page.route('**/protected',r=>{calls++;return r.fulfill(calls===1?{status:401,json:{detail:'expired'}}:{json:{ok:true}});});
 await page.evaluate(()=>(window as any).t.a.setToken('login'));
 expect(await page.evaluate(async()=>await (window as any).t.api.getAuthJson('/protected','cookie-session'))).toEqual({ok:true});
 await page.route('**/outage',r=>r.fulfill({status:503,json:{detail:'offline'}}));
 expect(await page.evaluate(async()=>{const t=(window as any).t;try{await t.api.getAuthJson('/outage','cookie-session');}catch{}return t.a.getAuthStatus();})).toBe('authenticated');
});
