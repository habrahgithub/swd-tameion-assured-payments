/** @vitest-environment jsdom */
import {describe,it,expect,vi,afterEach} from 'vitest';
import {act,render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {OperatorDashboard} from '../app/operator-dashboard';
vi.mock('../app/command-center',()=>({CommandCenter:({operatorControls,walletSummary}:{operatorControls:import("react").ReactNode;walletSummary?:import("react").ReactNode})=> <div>{operatorControls}{walletSummary}Protected queue</div>}));
afterEach(cleanup);
describe('operator dashboard boundary',()=>{
 it('does not mount private queue or refresh balance until verified session and click',async()=>{const fetcher=vi.fn(async(_path:RequestInfo|URL)=>Response.json({authenticated:true,csrf_token:'mock-csrf',expires_at:new Date(Date.now()+3600000).toISOString()}));render(<OperatorDashboard fetcher={fetcher}/>);expect(screen.queryByText('Protected queue')).toBeNull();await screen.findByText('Protected queue');fireEvent.click(screen.getByText('Operator',{exact:true}));expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('/api/operator/session');fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));});
 it('shows one visible read-only balance summary and manual refresh without a disclosure',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({amount:'12.345678',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));
  render(<OperatorDashboard fetcher={fetcher}/>);await screen.findByText('Protected queue');
  const summary=screen.getByRole('region',{name:'Read-only wallet balance'});
  expect(summary.closest('details')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await screen.findByText(/12.345678 USDC/);
  expect(summary.textContent).toContain('ARC-TESTNET');expect(summary.textContent).toContain('Observed');
  expect(summary.textContent).toContain('does not establish affordability');expect(screen.getAllByRole('button',{name:'Refresh wallet balance'})).toHaveLength(1);
 });
 it('expires the session and discards a balance response received afterward',async()=>{
  vi.useFakeTimers();let finish!:(r:Response)=>void;
  try {
   const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+1000).toISOString()}):new Promise<Response>(r=>{finish=r;}));
   render(<OperatorDashboard fetcher={fetcher}/>);
   await act(async()=>{await Promise.resolve();await Promise.resolve();});
   expect(screen.getByText('Protected queue')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));
   await act(async()=>{vi.advanceTimersByTime(1001);});
   expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Session expired');
   await act(async()=>{finish(Response.json({amount:'999',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));});
   expect(screen.queryByText(/999/)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {vi.useRealTimers();}
 });
 it('denies private view when session cannot be verified',async()=>{render(<OperatorDashboard fetcher={async()=>Response.json({code:'AUTH_UNAVAILABLE'},{status:503})}/>);await screen.findByText(/Session unavailable/);expect(screen.queryByText('Protected queue')).toBeNull();});
 it('logout removes private view before durable response and discards a late balance',async()=>{let finish!:(r:Response)=>void;const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3600000).toISOString()}):String(input).includes('refresh')?new Promise<Response>(r=>{finish=r;}):Response.json({code:'LOGOUT_UNVERIFIED'},{status:503}));render(<OperatorDashboard fetcher={fetcher}/>);await screen.findByText('Protected queue');fireEvent.click(screen.getByText('Operator',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(screen.queryByText('Protected queue')).toBeNull();finish(Response.json({amount:'999',asset:'USDC',captured_at:new Date(Date.now()+3600000).toISOString()}));await screen.findByText(/Logout unverified/);expect(screen.queryByText(/999/)).toBeNull();});
});
