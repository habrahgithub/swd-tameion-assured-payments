// @vitest-environment jsdom
import React from 'react';
import {renderToString} from 'react-dom/server';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LoginIntroduction,LoginJourney} from '../app/operator/login/login-branding';
import OperatorLogin from '../app/operator/login/operator-login';

let preference: EventTarget;
let reduced=false;
beforeEach(()=>{
 preference=new EventTarget();reduced=false;
 vi.stubGlobal('matchMedia',()=>({get matches(){return reduced;},addEventListener:preference.addEventListener.bind(preference),removeEventListener:preference.removeEventListener.bind(preference)}));
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function visibility(value:string){act(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));});}
describe('login conceptual motion',()=>{
 it('shows concise Circle, Arc and USDC context without presenting the concept as live activity',()=>{
  render(<LoginIntroduction/>);
  expect(screen.getByText('Circle · Arc · USDC')).toBeTruthy();
  expect(screen.getByText('Illustrative workflow')).toBeTruthy();
  expect(screen.queryByText(/no live transactions/i)).toBeNull();
 });
 it('renders a finished static composition before browser preferences are known',()=>{
  expect(renderToString(<LoginJourney/>)).toContain('data-motion="static"');
 });
 it('exposes an accessible pause/play control and retains a user pause across preference changes',()=>{
  render(<LoginJourney/>);
  const scene=screen.getByTestId('login-journey');
  expect(scene.getAttribute('data-motion')).toBe('running');
  fireEvent.click(screen.getByRole('button',{name:'Pause illustration'}));
  expect(scene.getAttribute('data-motion')).toBe('paused');
  act(()=>{reduced=true;preference.dispatchEvent(new Event('change'));});
  act(()=>{reduced=false;preference.dispatchEvent(new Event('change'));});
  expect(scene.getAttribute('data-motion')).toBe('paused');
  visibility('hidden');visibility('visible');
  expect(scene.getAttribute('data-motion')).toBe('paused');
  fireEvent.click(screen.getByRole('button',{name:'Play illustration'}));
  expect(scene.getAttribute('data-motion')).toBe('running');
 });
 it('pauses on hidden pages and resumes only if user and system allow motion',()=>{
  render(<LoginJourney/>);const scene=screen.getByTestId('login-journey');
  visibility('hidden');expect(scene.getAttribute('data-motion')).toBe('paused');
  visibility('visible');expect(scene.getAttribute('data-motion')).toBe('running');
  act(()=>{reduced=true;preference.dispatchEvent(new Event('change'));});
  expect(scene.getAttribute('data-motion')).toBe('static');
  expect((screen.getByRole('button',{name:'Play illustration'}) as HTMLButtonElement).disabled).toBe(true);
  visibility('hidden');visibility('visible');expect(scene.getAttribute('data-motion')).toBe('static');
 });
 it('defaults to the finished static composition for reduced motion',()=>{
  reduced=true;render(<LoginJourney/>);
  expect(screen.getByTestId('login-journey').getAttribute('data-motion')).toBe('static');
  expect(screen.getByText('Illustrative workflow')).toBeTruthy();
 });
});
it('preserves CSRF bootstrap, credentials, failure wording and form reset while paused',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({csrf_token:'MOCK-ONLY'})).mockResolvedValueOnce(Response.json({authenticated:false},{status:403}));vi.stubGlobal('fetch',fetcher);
 render(<OperatorLogin/>);fireEvent.click(screen.getByRole('button',{name:'Pause illustration'}));
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'mock-finance'}});
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'mock-password'}});
 fireEvent.submit(screen.getByRole('button',{name:'Sign in securely'}).closest('form')!);
 await screen.findByText('Sign-in could not be verified. Access may be unavailable or rate limited. Try again after the stated access limit.');
 expect(fetcher.mock.calls[0]).toEqual(['/api/operator/csrf',expect.objectContaining({method:'POST',credentials:'same-origin',cache:'no-store',body:'{}',headers:{'Content-Type':'application/json','X-Tameion-CSRF-Bootstrap':'1'}})]);
 expect(fetcher.mock.calls[1]).toEqual(['/api/operator/login',expect.objectContaining({method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF':'MOCK-ONLY'},body:JSON.stringify({username:'mock-finance',password:'mock-password'})})]);
 expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
 expect((screen.getByRole('button',{name:'Sign in securely'}) as HTMLButtonElement).disabled).toBe(false);
});
it('marks a successful sign-in for the dashboard entry without triggering a balance refresh',async()=>{
 const navigate=vi.fn();const fetcher=vi.fn().mockResolvedValueOnce(Response.json({csrf_token:'MOCK-ONLY'})).mockResolvedValueOnce(Response.json({authenticated:true}));vi.stubGlobal('fetch',fetcher);
 render(<OperatorLogin navigate={navigate}/>);fireEvent.change(screen.getByLabelText('Username'),{target:{value:'mock-user'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'mock-password'}});fireEvent.submit(screen.getByRole('button',{name:'Sign in securely'}).closest('form')!);
 await vi.waitFor(()=>expect(navigate).toHaveBeenCalledWith('/'));expect(sessionStorage.getItem('tameion-fresh-login')).toBe('1');
});
