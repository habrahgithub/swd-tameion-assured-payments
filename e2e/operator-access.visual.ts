import {test,expect} from './network-fence';
import AxeBuilder from '@axe-core/playwright';
test('unconfigured operator routes deny before admission and expose no private queue',async({page,request})=>{
 for(const route of ['operator/csrf','operator/login','operator/logout','wallet/balance/refresh']){const r=await request.post('/api/'+route,{data:{}});expect([403,503]).toContain(r.status());expect(r.headers()['cache-control']).toContain('no-store');}
 const session=await request.get('/api/operator/session');expect(session.status()).toBe(503);expect(await session.json()).toEqual({code:'AUTH_UNAVAILABLE'});
 await page.goto('/');await expect(page.getByLabel('Username')).toBeVisible();await expect(page.getByLabel('Password')).toHaveAttribute('type','password');await expect(page.getByRole('status')).toContainText('Access service unavailable');await expect(page.locator('button[data-obligation-id]')).toHaveCount(0);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 for(const width of [1365,390,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('mock session enables only manual balance and logout hides private view',async({page})=>{
 const calls:string[]=[];
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push(path);
 if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-ONLY-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
 if(path==='/api/obligations')return route.fulfill({json:{obligations:[],assessed_count:0,total_count:0}});
 if(path==='/api/wallet/balance/refresh')return route.fulfill({json:{amount:'12.345678',asset:'USDC',captured_at:new Date().toISOString(),network:'ARC-TESTNET',verification:'READ_ONLY_BALANCE'}});
 if(path==='/api/operator/logout')return route.fulfill({status:503,json:{code:'LOGOUT_UNVERIFIED'}});
 return route.fulfill({status:403,json:{code:'MOCK_UNADMITTED'}});});
 await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();await page.getByText('User',{exact:true}).click();const workspace=page.getByRole('region',{name:'User session and workspace'});await expect(workspace.getByText('User session verified')).toBeVisible();await expect(workspace.getByText('Star Wealth Dynamics LLC')).toBeVisible();await expect(workspace.getByText('ORG-DEMO-001')).toBeVisible();expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(0);
 await page.getByRole('button',{name:'Color theme: system'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'Color theme: light'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 24, 39)');expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.getByRole('button',{name:'Color theme: dark'}).click();await expect(page.locator('html')).not.toHaveAttribute('data-theme');await page.getByText('User',{exact:true}).click();
 await page.getByRole('button',{name:'Refresh wallet balance',exact:true}).click();await expect(page.getByText(/12.345678 USDC/)).toBeVisible();
 expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(1);
 await page.getByText('User',{exact:true}).click();await page.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.getByRole('status')).toContainText('Logout unverified');await expect(page.getByText(/12.345678 USDC/)).toHaveCount(0);
 expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
});

test('private entry hides data on reload and simulated BFcache restore, with responsive approved branding',async({page},testInfo)=>{
 const calls:string[]=[];
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push(path);
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/obligations')return route.fulfill({json:{obligations:[],total_count:0,assessed_count:0}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({json:{amount:'1.23',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}});
  return route.fulfill({status:403,json:{code:'MOCK_DENIED'}});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Your workspace is hidden'})).toBeVisible();
 expect(calls).toEqual(['/api/operator/session']);await expect(page.locator('button[data-obligation-id]')).toHaveCount(0);
 for(const width of [1440,1365,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.waitForFunction(theme=>getComputedStyle(document.body).backgroundColor===(theme==='dark'?'rgb(17, 24, 39)':'rgb(248, 250, 252)'),theme);
  await expect(page.getByRole('button',{name:'Open workspace'})).toBeVisible();await expect(page.getByRole('img',{name:'Tameion shield and document illustration'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.getByRole('button',{name:'Open workspace'}).evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath(`privacy-entry-${width}-${theme}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'Open workspace'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();await expect(page.getByText(/1.23 USDC/)).toHaveCount(0);expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(0);
 await page.getByRole('button',{name:'Refresh wallet balance'}).click();await expect(page.getByText(/1.23 USDC/)).toBeVisible();expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(1);
 await page.reload();await expect(page.getByRole('heading',{name:'Your workspace is hidden'})).toBeVisible();await expect(page.getByText(/1.23 USDC/)).toHaveCount(0);expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(1);
 await page.getByRole('button',{name:'Open workspace'}).click();await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();await expect(page.getByText(/1.23 USDC/)).toHaveCount(0);expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(1);
 // Simulated restore: this is not proof that Chromium used native BFcache.
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect(page.getByRole('heading',{name:'Your workspace is hidden'})).toBeVisible();await expect(page.getByText(/1.23 USDC/)).toHaveCount(0);
 expect(calls.filter(p=>p==='/api/wallet/balance/refresh')).toHaveLength(1);
});

test('missing session at homepage reaches branded login directly',async({page})=>{
 await page.route('**/api/operator/session',route=>route.fulfill({status:401,json:{code:'SESSION_REQUIRED'}}));
 await page.goto('/');await expect(page).toHaveURL(/\/operator\/login$/);
 await expect(page.getByLabel('Username')).toBeVisible();await expect(page.getByLabel('Password')).toBeVisible();
 await expect(page.getByRole('img',{name:'Tameion',exact:true})).toHaveAttribute('src','/brand/tameion-wordmark.svg');
});
