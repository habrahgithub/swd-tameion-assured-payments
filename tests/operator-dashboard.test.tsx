/** @vitest-environment jsdom */
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {act,render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {formatWalletAmount,OperatorDashboard} from '../app/operator-dashboard';
vi.mock('../app/command-center',()=>({CommandCenter:({operatorControls,walletSummary,csrfToken}:{operatorControls:import("react").ReactNode;walletSummary?:import("react").ReactNode;csrfToken?:string})=> <div>{operatorControls}{walletSummary}<span data-testid="command-csrf">{csrfToken}</span>Protected queue</div>}));
beforeEach(()=>{window.history.replaceState(null,'','/?refresh_balance=1');Object.defineProperty(performance,'getEntriesByType',{configurable:true,value:vi.fn(()=>[{type:'navigate'}])});});
afterEach(()=>{vi.useRealTimers();cleanup();sessionStorage.clear();window.localStorage.removeItem('tameion-theme');delete document.documentElement.dataset.theme;window.history.replaceState(null,'','/');});
describe('operator dashboard boundary',()=>{
 async function openWorkspace(){fireEvent.click(await screen.findByRole('button',{name:'Open workspace'}));await screen.findByText('Protected queue');}
 it('rounds wallet balances half-up to six decimals and preserves finance-friendly grouping',()=>{
  expect(formatWalletAmount('19.989211477825042')).toBe('19.989211');
  expect(formatWalletAmount('12.9999999')).toBe('13.00');
  expect(formatWalletAmount('1234')).toBe('1,234.00');
 });
 it('keeps the verified session private until explicit open revalidation, then reads balance once',async()=>{const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock-csrf',expires_at:new Date(Date.now()+3600000).toISOString()}):Response.json({amount:'12.34',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));render(<OperatorDashboard fetcher={fetcher}/>);await screen.findByRole('button',{name:'Open workspace'});expect(screen.queryByText('Protected queue')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);await openWorkspace();expect(screen.getByTestId('command-csrf').textContent).toBe('mock-csrf');expect(window.location.search).toBe('');expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls[0][0]).toBe('/api/operator/session');expect(fetcher.mock.calls[1][0]).toBe('/api/operator/session');expect(fetcher.mock.calls[2][0]).toBe('/api/wallet/balance/refresh');expect(fetcher.mock.calls[2][1]).toMatchObject({method:'POST',headers:{'X-Tameion-CSRF':'mock-csrf'}});});
 it('shows one visible read-only balance summary and keeps manual refresh available',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({amount:'12.345678000000000000',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  const summary=screen.getByRole('region',{name:'Read-only wallet balance'});
  expect(summary.closest('details')).toBeNull();const displayed=await screen.findByText(/12.345678 USDC/);expect(displayed.textContent).not.toContain('12.345678000000000000');expect(displayed.getAttribute('title')).toContain('12.345678000000000000');expect(fetcher).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(4));
  expect(summary.textContent).toContain('ARC-TESTNET');expect(summary.textContent).toContain('Observed');
  expect(summary.textContent).toContain('does not establish affordability');expect(screen.getAllByRole('button',{name:'Refresh wallet balance'})).toHaveLength(1);
 });
 it('shows the design-partner organization and provides a persistent accessible theme control',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({code:'BALANCE_UNVERIFIED'},{status:503}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  const profile=screen.getByLabelText('User session and workspace');expect(profile.textContent).toContain('Star Wealth Dynamics LLC');expect(profile.textContent).toContain('ORG-DEMO-001');expect(profile.textContent).toContain('Internal pilot');
  const summary=screen.getByTestId('organization-summary');expect(summary.textContent).toContain('Star Wealth Dynamics LLC');expect(summary.textContent).toContain('ORG-DEMO-001');
  const theme=screen.getByRole('button',{name:'Color theme: system'});fireEvent.click(theme);
  expect(document.documentElement.dataset.theme).toBe('light');expect(window.localStorage.getItem('tameion-theme')).toBe('light');
  fireEvent.click(screen.getByRole('button',{name:'Color theme: light'}));expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button',{name:'Color theme: dark'}));expect(document.documentElement.dataset.theme).toBeUndefined();expect(window.localStorage.getItem('tameion-theme')).toBeNull();
 });
 it('expires the session and discards a balance response received afterward',async()=>{
  vi.useFakeTimers();Object.defineProperty(performance,'getEntriesByType',{configurable:true,value:vi.fn(()=>[{type:'navigate'}])});let finish!:(r:Response)=>void;
  try {
   const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+1000).toISOString()}):new Promise<Response>(r=>{finish=r;}));
   render(<OperatorDashboard fetcher={fetcher}/>);await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
   fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
   expect(screen.getByText('Protected queue')).toBeTruthy();
   await act(async()=>{vi.advanceTimersByTime(1001);});
   expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Session expired');
   await act(async()=>{finish(Response.json({amount:'999',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));});
   expect(screen.queryByText(/999/)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {vi.useRealTimers();}
 });
 it('presents only a missing-session 401 as a normal sign-in requirement',async()=>{render(<OperatorDashboard navigate={vi.fn()} fetcher={async()=>Response.json({code:'SESSION_REQUIRED'},{status:401})}/>);await screen.findByText(/Sign-in required/);const status=screen.getByRole('status');expect(status.textContent).not.toMatch(/rejected|unavailable/i);expect(screen.queryByText('Protected queue')).toBeNull();});
 it('presents a 403 access rejection without suggesting that sign-in will resolve it',async()=>{render(<OperatorDashboard navigate={vi.fn()} fetcher={async()=>Response.json({code:'ACCESS_REJECTED'},{status:403})}/>);await screen.findByText(/Access could not be verified from this location/);const status=screen.getByRole('status');expect(status.textContent).toMatch(/approved workspace address/);expect(status.textContent).not.toMatch(/sign-in required|sign in to continue/i);expect(screen.queryByText('Protected queue')).toBeNull();});
 it('reserves unavailable language for a confirmed access-service failure',async()=>{render(<OperatorDashboard navigate={vi.fn()} fetcher={async()=>Response.json({code:'AUTH_UNAVAILABLE'},{status:503})}/>);await screen.findByText(/Access service unavailable/);const status=screen.getByRole('status');expect(status.textContent).not.toMatch(/sign-in required|approved workspace address/i);expect(screen.queryByText('Protected queue')).toBeNull();});
 it('logout removes private view before durable response and discards a late balance',async()=>{let finish!:(r:Response)=>void;const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3600000).toISOString()}):String(input).includes('refresh')?new Promise<Response>(r=>{finish=r;}):Response.json({code:'LOGOUT_UNVERIFIED'},{status:503}));render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(screen.queryByText('Protected queue')).toBeNull();finish(Response.json({amount:'999',asset:'USDC',captured_at:new Date(Date.now()+3600000).toISOString()}));await screen.findByText(/Logout unverified/);expect(screen.queryByText(/999/)).toBeNull();});
});
