import {test as base} from '@playwright/test';
import {appendFileSync} from 'node:fs';
/** Runner-only fence. Page mocks have precedence; unmatched external requests
 * are aborted. No production environment flag or runtime bypass is introduced. */
export const test=base.extend<{networkFence:void}>({networkFence:[async({page,browser},use)=>{
 let incident=false;
 const arm=async(context:import('@playwright/test').BrowserContext)=>context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:3190')return route.continue();
  incident=true;const output=process.env.TAMEION_BROWSER_INCIDENT_FILE;if(output)appendFileSync(output,JSON.stringify({code:'UNEXPECTED_BROWSER_NETWORK',origin:url.origin})+'\n');
  await route.abort('blockedbyclient');throw new Error('Unexpected external browser request; verification stopped.');
 });
 await arm(page.context());const original=browser.newPage.bind(browser);
 browser.newPage=async(options)=>{const p=await original(options);await arm(p.context());return p;};
 try{await use();if(incident)throw new Error('UNEXPECTED_BROWSER_NETWORK');}finally{browser.newPage=original;}
},{auto:true}]});
export {expect} from '@playwright/test';

export type {Page,TestInfo} from '@playwright/test';
