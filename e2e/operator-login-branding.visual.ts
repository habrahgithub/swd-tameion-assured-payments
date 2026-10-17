import {test,expect} from './network-fence';
import AxeBuilder from '@axe-core/playwright';
import {writeFileSync} from 'node:fs';
import type {Page} from '@playwright/test';

async function theme(page:Page,value:'light'|'dark'){
 await page.addInitScript(value=>localStorage.setItem('tameion-theme',value),value);
 await page.goto('/operator/login');
 await expect(page.locator('html')).toHaveAttribute('data-theme',value);
}

for(const color of ['light','dark'] as const){
 test(`login branding ${color}: responsive, accessible and stable`,async({page},info)=>{
  const errors:string[]=[];const requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('request',request=>requests.push(request.url()));
  await theme(page,color);
  await expect(page.getByRole('heading',{name:'From invoice to assured payment.'})).toBeVisible();
  await expect(page.getByTestId('login-journey')).toHaveAttribute('data-motion','running');
  const metrics=[];
  for(const width of [1440,1365,390,320]){
   await page.setViewportSize({width,height:900});
   await page.getByRole('button',{name:'Pause illustration'}).click();
   const layout=await page.evaluate(()=>{
    const form=document.querySelector('form')!.getBoundingClientRect();
    const figure=document.querySelector('figure')!.getBoundingClientRect();
    const svgs=[...document.querySelectorAll('figure svg')].filter(el=>el.getBoundingClientRect().width>0);
    const labels=svgs.flatMap(svg=>[...svg.querySelectorAll('text')].map(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize)*Math.min(svg.getBoundingClientRect().width/(svg as SVGSVGElement).viewBox.baseVal.width,svg.getBoundingClientRect().height/(svg as SVGSVGElement).viewBox.baseVal.height)})));
    const boxes=svgs.flatMap(svg=>[...svg.querySelectorAll('text')].map(el=>el.getBoundingClientRect().toJSON()));
    const overlappingLabels=boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
    return {overlappingLabels,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,form:{x:form.x,y:form.y,width:form.width,height:form.height},figure:{x:figure.x,y:figure.y,width:figure.width,height:figure.height},labels};
   });
   expect(layout.scrollWidth).toBeLessThanOrEqual(width);
   expect(layout.overlappingLabels).toBe(false);
   expect(layout.form.width).toBeGreaterThan(220);
   expect(layout.form.x).toBeGreaterThanOrEqual(0);expect(layout.form.x+layout.form.width).toBeLessThanOrEqual(width);
   expect(layout.figure.y+layout.figure.height<=layout.form.y||layout.figure.x+layout.figure.width<=layout.form.x).toBe(true);
   expect(layout.labels.every(label=>label.size>=10)).toBe(true);
   expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
   await page.screenshot({path:info.outputPath(`precommit-${color}-${width}.png`),fullPage:true});
   metrics.push(layout);
   await page.getByRole('button',{name:'Play illustration'}).click();
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('link',{name:'Tameion home'}).focus();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:`Color theme: ${color}`})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Pause illustration'})).toBeFocused();
  await page.keyboard.press('Space');await expect(page.getByTestId('login-journey')).toHaveAttribute('data-motion','paused');
  await page.keyboard.press('Tab');await expect(page.getByLabel('Username')).toBeFocused();
  expect(errors).toEqual([]);
  expect(requests.every(url=>new URL(url).origin==='http://127.0.0.1:3190')).toBe(true);
  expect(requests.some(url=>url.endsWith('/brand/tameion-wordmark.svg'))).toBe(true);
  expect(requests.filter(url=>url.includes('/api/'))).toEqual([]);
  writeFileSync(info.outputPath('layout-and-network.json'),JSON.stringify({metrics,errors,requests},null,2));
 });
}

for(const state of ['running','paused','reduced'] as const){
 test(`MOCK ONLY successful login opens privacy entry while ${state}`,async({page})=>{
  if(state==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
  const calls:{path:string;body:unknown;headers:Record<string,string>}[]=[];
  await page.route('**/api/**',async route=>{
   const request=route.request();const path=new URL(request.url()).pathname;
   calls.push({path,body:request.postDataJSON(),headers:request.headers()});
   if(path==='/api/operator/csrf')return route.fulfill({json:{csrf_token:'MOCK-ONLY-CSRF'}});
   if(path==='/api/operator/login')return route.fulfill({json:{authenticated:true}});
   if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-ONLY-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
   throw new Error('Unexpected API call');
  });
  await page.goto('/operator/login');
  if(state==='paused')await page.getByRole('button',{name:'Pause illustration'}).click();
  await expect(page.getByTestId('login-journey')).toHaveAttribute('data-motion',state==='reduced'?'static':state);
  await page.getByLabel('Username').fill('mock-finance');await page.getByLabel('Password').fill('mock-password');
  await page.getByRole('button',{name:'Sign in securely'}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3190/');
  await expect(page.getByRole('heading',{name:'Your workspace is hidden'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open workspace'})).toBeVisible();
  await expect(page.locator('button[data-obligation-id]')).toHaveCount(0);
  expect(calls.map(call=>call.path)).toEqual(['/api/operator/csrf','/api/operator/login','/api/operator/session']);
  expect(calls.some(call=>call.path==='/api/wallet/balance/refresh')).toBe(false);
  expect(calls[0].body).toEqual({});expect(calls[0].headers['x-tameion-csrf-bootstrap']).toBe('1');
  expect(calls[1].body).toEqual({username:'mock-finance',password:'mock-password'});expect(calls[1].headers['x-tameion-csrf']).toBe('MOCK-ONLY-CSRF');
 });
}

test('full 18 second motion video, control, reduced motion, visibility and bounded resource evidence',async({page},info)=>{
 test.setTimeout(60000); // Full loop plus pause/static evidence, not a timeout relaxation.
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:900});await theme(page,'dark');
 const journey=page.getByTestId('login-journey');await expect(journey).toHaveAttribute('data-motion','running');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const before=await cdp.send('Performance.getMetrics');
 const animationEvidence=await page.evaluate(()=>{
  const figure=document.querySelector('figure')!;
  const animations=figure.getAnimations({subtree:true});
  return animations.filter(animation=>animation instanceof CSSAnimation).map(animation=>({name:(animation as CSSAnimation).animationName,timing:animation.effect!.getTiming()}));
 });
 expect(animationEvidence.length).toBe(11);
 expect(animationEvidence.every(animation=>animation.timing.duration===18000)).toBe(true);
 // The browser supplies the animation clock; test samples stage order without changing it.
 const samples:{second:number;human:string;assurance:string;wallets:string;outgoing:string;returnPulse:string;form:unknown}[]=[];
 await page.evaluate(()=>document.querySelector('figure')!.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=0;}));
 const started=Date.now();
 for(const second of [0,4,7,9,12,16,18]){
  if(second)await page.waitForTimeout(Math.max(0,second*1000-(Date.now()-started)));
  samples.push({second,...await page.evaluate(()=>{
   const svg=[...document.querySelectorAll('figure svg')].find(el=>el.getBoundingClientRect().width>0)!;
   const opacity=(part:string)=>getComputedStyle(svg.querySelector(`[class*="${part}"]`)!).opacity;
   return {human:opacity('human'),assurance:opacity('assurance'),wallets:opacity('wallets'),outgoing:opacity('outgoing'),returnPulse:opacity('returnPulse'),form:document.querySelector('form')!.getBoundingClientRect().toJSON()};
  })});
  await page.screenshot({path:info.outputPath(`precommit-motion-${second}s.png`)});
 }
 expect(Number(samples[2].human)).toBeGreaterThan(.9);expect(Number(samples[2].outgoing)).toBe(0);
 expect(Number(samples[3].assurance)).toBeGreaterThan(.9);expect(Number(samples[3].outgoing)).toBe(0);
 expect(Number(samples[4].outgoing)).toBeGreaterThan(.8);expect(Number(samples[5].returnPulse)).toBeGreaterThan(.5);
 expect(samples.every(sample=>JSON.stringify(sample.form)===JSON.stringify(samples[0].form))).toBe(true);
 const after=await cdp.send('Performance.getMetrics');
 await page.getByRole('button',{name:'Pause illustration'}).click();await expect(journey).toHaveAttribute('data-motion','paused');
 const time=await page.evaluate(()=>document.querySelector('figure')!.getAnimations({subtree:true}).map(a=>a.currentTime));
 await page.waitForTimeout(1000);
 expect(await page.evaluate(()=>document.querySelector('figure')!.getAnimations({subtree:true}).map(a=>a.currentTime))).toEqual(time);
 await page.screenshot({path:info.outputPath('precommit-paused.png')});
 // CDP backgrounding is unavailable in headless Chromium: dispatch the real visibility handler
 // against a simulated hidden document, and record this explicitly as simulated evidence.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(journey).toHaveAttribute('data-motion','paused');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(journey).toHaveAttribute('data-motion','paused');
 await page.getByRole('button',{name:'Play illustration'}).click();
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(journey).toHaveAttribute('data-motion','paused');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(journey).toHaveAttribute('data-motion','running');
 await page.emulateMedia({reducedMotion:'reduce'});await expect(journey).toHaveAttribute('data-motion','static');
 await expect(page.getByRole('button',{name:'Play illustration'})).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>document.querySelector('figure')!.getAnimations({subtree:true}).length)).toBe(0);
 await page.screenshot({path:info.outputPath('precommit-reduced-motion.png')});await page.waitForTimeout(1000);
 expect(errors).toEqual([]);
 writeFileSync(info.outputPath('motion-resource-evidence.json'),JSON.stringify({animationEvidence,samples,before,after,errors,visibility:'simulated visibilityState + real visibilitychange handler; headless limitation'},null,2));
});
