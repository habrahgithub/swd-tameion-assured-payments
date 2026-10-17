/** @vitest-environment jsdom */
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {act,render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {formatWalletAmount,OperatorDashboard} from '../app/operator-dashboard';
vi.mock('../app/command-center',()=>({CommandCenter:({operatorControls,walletSummary,csrfToken,initialView}:{operatorControls:import("react").ReactNode;walletSummary?:import("react").ReactNode;csrfToken?:string;initialView?:string})=> <div data-initial-view={initialView}>{operatorControls}{walletSummary}<span data-testid="command-csrf">{csrfToken}</span>Protected queue</div>}));
beforeEach(()=>{window.history.replaceState(null,'','/?refresh_balance=1');Object.defineProperty(performance,'getEntriesByType',{configurable:true,value:vi.fn(()=>[{type:'navigate'}])});Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))});});
afterEach(()=>{vi.useRealTimers();cleanup();sessionStorage.clear();window.localStorage.removeItem('tameion-theme');delete document.documentElement.dataset.theme;window.history.replaceState(null,'','/');});
describe('operator dashboard boundary',()=>{
 async function openWorkspace(){fireEvent.click(await screen.findByRole('button',{name:'Open workspace'}));await screen.findByText('Protected queue');}
 it('rounds wallet balances half-up to two decimals and preserves finance-friendly grouping',()=>{
  expect(formatWalletAmount('19.989211477825042')).toBe('19.99');
  expect(formatWalletAmount('12.9999999')).toBe('13.00');
  expect(formatWalletAmount('1234')).toBe('1,234.00');
 });
 it.each([
  ['0.000001','0.00'],['999999999999999999.999999999999999999','1,000,000,000,000,000,000.00'],['0','0.00'],['1.005','1.01'],
 ])('keeps the canonical %s balance accessible without numeric precision loss',async(amount,rounded)=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({amount,asset:'USDC',network:'ARC-TESTNET',captured_at:'2026-10-16T00:00:00.000Z',verification:'READ_ONLY_BALANCE'}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));
  expect(await screen.findByText(`${rounded} USDC`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Show exact'}));
  expect(screen.getByText(`${amount} USDC`)).toBeTruthy();
  expect(screen.getByRole('region',{name:'Read-only wallet balance'}).textContent).toContain('Observed');
  expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('keeps a returning session private until revalidation, then opens the dashboard without refreshing balance',async()=>{const fetcher=vi.fn(async(_input:RequestInfo|URL)=>Response.json({authenticated:true,csrf_token:'mock-csrf',expires_at:new Date(Date.now()+3600000).toISOString()}));render(<OperatorDashboard fetcher={fetcher}/>);await screen.findByRole('button',{name:'Open workspace'});expect(screen.queryByText('Protected queue')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);await openWorkspace();expect(screen.getByTestId('command-csrf').textContent).toBe('mock-csrf');expect(screen.getByTestId('command-csrf').parentElement?.getAttribute('data-initial-view')).toBe('dashboard');expect(window.location.search).toBe('');expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/operator/session','/api/operator/session']);});
 it('shows one visible read-only balance summary and keeps manual refresh available',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({amount:'12.345678000000000000',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  const summary=screen.getByRole('region',{name:'Read-only wallet balance'});
  expect(summary.closest('details')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.every(call=>call[0]!=='/api/wallet/balance/refresh')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));const displayed=await screen.findByText(/12.35 USDC/);expect(displayed.textContent).not.toContain('12.345678000000000000');expect(displayed.getAttribute('title')).toContain('12.345678000000000000');
  const exact=screen.getByRole('button',{name:'Show exact'});fireEvent.click(exact);
  expect(exact.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('12.345678000000000000 USDC')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Show rounded'}));
  expect(screen.getByText('12.35 USDC')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(3);
  expect(summary.textContent).toContain('ARC-TESTNET');expect(summary.textContent).toContain('Observed');
  expect(summary.textContent).toContain('does not establish affordability');expect(screen.getAllByRole('button',{name:'Refresh wallet balance'})).toHaveLength(1);
 });
 it('shows the design-partner organization and provides a persistent accessible theme control',async()=>{
  const fetcher=vi.fn(async()=>Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  const profile=screen.getByLabelText('User session and workspace');expect(profile.textContent).toContain('Star Wealth Dynamics LLC');expect(profile.textContent).toContain('ORG-DEMO-001');expect(profile.textContent).toContain('Internal pilot');
  const summary=screen.getByTestId('organization-summary');expect(summary.textContent).toContain('Star Wealth Dynamics LLC');expect(summary.textContent).toContain('ORG-DEMO-001');
  const theme=screen.getByRole('button',{name:'Color theme: system'});fireEvent.click(theme);
  expect(document.documentElement.dataset.theme).toBe('light');expect(window.localStorage.getItem('tameion-theme')).toBe('light');
  fireEvent.click(screen.getByRole('button',{name:'Color theme: light'}));expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button',{name:'Color theme: dark'}));expect(document.documentElement.dataset.theme).toBeUndefined();expect(window.localStorage.getItem('tameion-theme')).toBeNull();
 });
 it('expires the session and discards a balance response received afterward',async()=>{
  vi.useFakeTimers();Object.defineProperty(performance,'getEntriesByType',{configurable:true,value:vi.fn(()=>[{type:'navigate'}])});
  try {
   const fetcher=vi.fn(async()=>Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+1000).toISOString()}));
   render(<OperatorDashboard fetcher={fetcher}/>);await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
   fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
   expect(screen.getByText('Protected queue')).toBeTruthy();
   await act(async()=>{vi.advanceTimersByTime(1001);});
   expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Session expired');
   expect(screen.queryByText(/999/)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {vi.useRealTimers();}
 });
 it('renders login immediately at home and keeps the 401 route to the dedicated login page',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'SESSION_REQUIRED'},{status:401})}/>);expect(screen.getByLabelText('Username')).toBeTruthy();await screen.findByText(/Sign in to continue/);expect(screen.getByLabelText('Password')).toBeTruthy();expect(navigate).toHaveBeenCalledWith('/operator/login');expect(screen.queryByText('Protected queue')).toBeNull();});
 it('renders login on the home route and preserves 403 location guidance',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'ACCESS_REJECTED'},{status:403})}/>);await screen.findByLabelText('Username');expect(screen.getByRole('status').textContent).toMatch(/approved workspace address/);expect(screen.getByRole('status').textContent).not.toMatch(/sign-in required|sign in to continue/i);expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText('Protected queue')).toBeNull();});
 it('renders login on the home route and preserves 503 service guidance',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'AUTH_UNAVAILABLE'},{status:503})}/>);await screen.findByLabelText('Username');expect(screen.getByRole('status').textContent).toMatch(/Access service unavailable/);expect(screen.getByRole('status').textContent).not.toMatch(/sign-in required|approved workspace address/i);expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText('Protected queue')).toBeNull();});
 it('logout removes private view and clears its balance before the durable response',async()=>{const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3600000).toISOString()}):Response.json({code:'LOGOUT_UNVERIFIED'},{status:503}));render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(screen.queryByText('Protected queue')).toBeNull();await screen.findByText(/Logout unverified/);expect(screen.queryByRole('region',{name:'Read-only wallet balance'})).toBeNull();});
});
