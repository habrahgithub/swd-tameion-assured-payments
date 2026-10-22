/** @vitest-environment jsdom */
import {useEffect,useRef,useState} from 'react';
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {act,render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {formatWalletAmount,OperatorDashboard} from '../app/operator-dashboard';
vi.mock('../app/command-center',()=>({CommandCenter:({operatorControls,walletSummary,csrfToken,initialView,onDisplay}:{operatorControls:import("react").ReactNode;walletSummary?:import("react").ReactNode;csrfToken?:string;initialView?:'dashboard'|'workflow';onDisplay?:(view:'dashboard'|'workflow')=>void})=>{
 const [view,setView]=useState(initialView??'workflow'),last=useRef<string|null>(null),callback=useRef(onDisplay);callback.current=onDisplay;
 useEffect(()=>{if(last.current===view)return;last.current=view;callback.current?.(view);},[view]);
 return <div data-initial-view={initialView}>{operatorControls}{walletSummary}<span data-testid="command-csrf">{csrfToken}</span>Protected queue<button onClick={()=>setView('workflow')}>Mock workflow</button><button onClick={()=>setView('dashboard')}>Mock Dashboard</button></div>;
}}));
beforeEach(()=>{window.history.replaceState(null,'','/?refresh_balance=1');Object.defineProperty(performance,'getEntriesByType',{configurable:true,value:vi.fn(()=>[{type:'navigate'}])});Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))});});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();cleanup();sessionStorage.clear();window.localStorage.removeItem('tameion-theme');delete document.documentElement.dataset.theme;window.history.replaceState(null,'','/');});
describe('operator dashboard boundary',()=>{
 it('accepts a fixed two-hour session, checks hourly quietly and still expires at the original boundary',async()=>{
  vi.useFakeTimers();const expires_at=new Date(Date.now()+7200000).toISOString();
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({authenticated:true,csrf_token:'fixed',expires_at}));
  render(<OperatorDashboard fetcher={fetcher}/>);await act(async()=>{for(let i=0;i<16;i++)await Promise.resolve();});
  fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await act(async()=>{for(let i=0;i<16;i++)await Promise.resolve();});
  expect(screen.getByText('Protected queue')).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3599999);});expect(sessionCalls(fetcher)).toHaveLength(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(sessionCalls(fetcher)).toHaveLength(3);expect(screen.getByText('Protected queue')).toBeTruthy();
  expect(walletCalls(fetcher)).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Session expired');expect(sessionCalls(fetcher)).toHaveLength(3);
 });
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
 it('keeps a returning session private before explicit entry, then observes balance once',async()=>{const fetcher=vi.fn(async(_input:RequestInfo|URL)=>Response.json({authenticated:true,csrf_token:'mock-csrf',expires_at:new Date(Date.now()+3600000).toISOString()}));render(<OperatorDashboard fetcher={fetcher}/>);await screen.findByRole('button',{name:'Open workspace'});expect(screen.queryByText('Protected queue')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);await openWorkspace();expect(screen.getByTestId('command-csrf').textContent).toBe('mock-csrf');expect(screen.getByTestId('command-csrf').parentElement?.getAttribute('data-initial-view')).toBe('dashboard');expect(window.location.search).toBe('');expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/operator/session','/api/operator/session','/api/wallet/balance/refresh']);});
 it('shows one visible read-only balance summary and keeps manual refresh available',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3500000).toISOString()}):Response.json({amount:'12.345678000000000000',asset:'USDC',network:'ARC-TESTNET',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));
  render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();
  const summary=screen.getByRole('region',{name:'Read-only wallet balance'});
  expect(summary.closest('details')).toBeNull();expect(walletCalls(fetcher)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));const displayed=await screen.findByText(/12.35 USDC/);expect(displayed.textContent).not.toContain('12.345678000000000000');expect(displayed.getAttribute('title')).toContain('12.345678000000000000');
  const exact=screen.getByRole('button',{name:'Show exact'});fireEvent.click(exact);
  expect(exact.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('12.345678000000000000 USDC')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Show rounded'}));
  expect(screen.getByText('12.35 USDC')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(3);
  expect(summary.textContent).toContain('ARC-TESTNET');expect(summary.textContent).toContain('Observed');
  expect(summary.textContent).toContain('does not establish affordability');expect(summary.textContent).not.toContain('No balance observed in this view');expect(screen.getAllByRole('button',{name:'Refresh wallet balance'})).toHaveLength(1);
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
   expect(screen.queryByText(/999/)).toBeNull();expect(sessionCalls(fetcher)).toHaveLength(2);expect(walletCalls(fetcher)).toHaveLength(1);
  } finally {vi.useRealTimers();}
 });
 it('renders login immediately at home and keeps the 401 route to the dedicated login page',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'SESSION_REQUIRED'},{status:401})}/>);expect(screen.getByLabelText('Username')).toBeTruthy();await screen.findByText(/Sign in to continue/);expect(screen.getByLabelText('Password')).toBeTruthy();expect(navigate).toHaveBeenCalledWith('/operator/login');expect(screen.queryByText('Protected queue')).toBeNull();});
 it('renders login on the home route and preserves 403 location guidance',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'ACCESS_REJECTED'},{status:403})}/>);await screen.findByLabelText('Username');expect(screen.getByRole('status').textContent).toMatch(/approved workspace address/);expect(screen.getByRole('status').textContent).not.toMatch(/sign-in required|sign in to continue/i);expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText('Protected queue')).toBeNull();});
 it('renders login on the home route and preserves 503 service guidance',async()=>{const navigate=vi.fn();render(<OperatorDashboard navigate={navigate} fetcher={async()=>Response.json({code:'AUTH_UNAVAILABLE'},{status:503})}/>);await screen.findByLabelText('Username');expect(screen.getByRole('status').textContent).toMatch(/Access service unavailable/);expect(screen.getByRole('status').textContent).not.toMatch(/sign-in required|approved workspace address/i);expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText('Protected queue')).toBeNull();});
 it('logout removes private view and clears its balance before the durable response',async()=>{const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('session')?Response.json({authenticated:true,csrf_token:'mock',expires_at:new Date(Date.now()+3600000).toISOString()}):Response.json({code:'LOGOUT_UNVERIFIED'},{status:503}));render(<OperatorDashboard fetcher={fetcher}/>);await openWorkspace();fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));expect(screen.queryByText('Protected queue')).toBeNull();await screen.findByText(/Logout unverified/);expect(screen.queryByRole('region',{name:'Read-only wallet balance'})).toBeNull();});
});

async function drain(){await act(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});}
function sessionCalls(f:{mock:{calls:unknown[][]}}){return f.mock.calls.filter(c=>c[0]==='/api/operator/session') as [RequestInfo|URL,RequestInit?][];}
function walletCalls(f:{mock:{calls:unknown[][]}}){return f.mock.calls.filter(c=>c[0]==='/api/wallet/balance/refresh') as [RequestInfo|URL,RequestInit?][];}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function hourlyFixture(next:()=>Promise<Response>){
 vi.useFakeTimers();const start=Date.now(),value={authenticated:true,csrf_token:'same-csrf',expires_at:new Date(start+7200000).toISOString()};let sessions=0;
 const fetcher=vi.fn<typeof fetch>(async(url)=>{if(String(url)==='/api/operator/session'){sessions++;return sessions<=2?Response.json(value):next();}return Response.json({revoked:true});});
 const mounted=render(<OperatorDashboard fetcher={fetcher}/>);await drain();fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(screen.getByText('Protected queue')).toBeTruthy();
 return {start,value,fetcher,...mounted};
}
describe('fixed expiry hourly privacy checks',()=>{
 it.each(['401','403','503','invalid','null','csrf','expiry','network'])('closes on %s without renewal, POST, navigation or lost operation keys',async kind=>{
  let value:Record<string,unknown>={};const t=await hourlyFixture(async()=>{if(kind==='network')throw Error('network');return Response.json(kind==='null'?null:kind==='invalid'?{authenticated:false}:kind==='csrf'?{...value,csrf_token:'other'}:kind==='expiry'?{...value,expires_at:new Date(Date.now()+7200000).toISOString()}:value,{status:/^\d+$/.test(kind)?Number(kind):200});});value=t.value;
  localStorage.setItem('tameion.assessment-request.SYNTHETIC','retained');await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});
  expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.queryByRole('region',{name:'Read-only wallet balance'})).toBeNull();expect(screen.getByRole('status').textContent).toContain('Server logout was not requested');expect(localStorage.getItem('tameion.assessment-request.SYNTHETIC')).toBe('retained');localStorage.removeItem('tameion.assessment-request.SYNTHETIC');
  await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(sessionCalls(t.fetcher)).toHaveLength(3);const options=sessionCalls(t.fetcher)[2][1]!;expect(options).toMatchObject({method:'GET',credentials:'same-origin',cache:'no-store'});expect(options.body).toBeUndefined();
 });
 it('settles a hanging ignored-abort check within10s, has no overlap/retry and ignores its late success',async()=>{
  const late=deferred<Response>();const t=await hourlyFixture(()=>late.promise);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});fireEvent.focus(window);fireEvent(document,new Event('visibilitychange'));expect(sessionCalls(t.fetcher)).toHaveLength(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(9999);});expect(screen.getByText('Protected queue')).toBeTruthy();await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(screen.queryByText('Protected queue')).toBeNull();expect(sessionCalls(t.fetcher)[2][1]!.signal!.aborted).toBe(true);
  late.resolve(Response.json(t.value));await drain();expect(screen.queryByText('Protected queue')).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(sessionCalls(t.fetcher)).toHaveLength(3);
 });
 it.each(['logout','pagehide','restore','unmount'])('invalidates a pending hourly reply on %s',async boundary=>{
  const late=deferred<Response>();const t=await hourlyFixture(()=>late.promise);await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});
  if(boundary==='logout'){fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));}
  else if(boundary==='unmount')t.unmount();else {const event=new Event(boundary==='restore'?'pageshow':'pagehide');Object.defineProperty(event,'persisted',{value:true});fireEvent(window,event);}
  expect(sessionCalls(t.fetcher)[2][1]!.signal!.aborted).toBe(true);late.resolve(Response.json(t.value));await drain();expect(screen.queryByText('Protected queue')).toBeNull();expect(t.fetcher.mock.calls.filter(([url])=>url==='/api/operator/session')).toHaveLength(3);
 });
 it('a quiet successful check does not abort or invalidate the independent pending balance read',async()=>{
  vi.useFakeTimers();const value={authenticated:true,csrf_token:'same',expires_at:new Date(Date.now()+7200000).toISOString()},wallet=deferred<Response>();
  const fetcher=vi.fn<typeof fetch>(async url=>String(url).includes('session')?Response.json(value):wallet.promise);
  render(<OperatorDashboard fetcher={fetcher}/>);await drain();fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(walletCalls(fetcher)).toHaveLength(1);
  const signal=fetcher.mock.calls[2][1]!.signal!;await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(signal.aborted).toBe(false);expect(fetcher).toHaveBeenCalledTimes(4);
  wallet.resolve(Response.json({asset:'USDC',amount:'12',captured_at:new Date().toISOString(),network:'SYNTHETIC',verification:'READ_ONLY_BALANCE'}));await drain();expect(screen.getByText('12.00 USDC')).toBeTruthy();expect(screen.getByTestId('command-csrf').textContent).toBe('same');
 });
 it('uses absolute time after delayed timers before dispatch and after a delayed response body',async()=>{
  const body=deferred<unknown>();const t=await hourlyFixture(async()=>({ok:true,json:()=>body.promise} as Response));await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});
  vi.setSystemTime(t.start+7200000);body.resolve(t.value);await drain();expect(screen.queryByText('Protected queue')).toBeNull();expect(sessionCalls(t.fetcher)).toHaveLength(3);
 });
 it('enforces the10s absolute deadline even when its timer callback has not fired',async()=>{
  const late=deferred<Response>();const t=await hourlyFixture(()=>late.promise);await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});vi.setSystemTime(t.start+3610000);late.resolve(Response.json(t.value));await drain();expect(screen.queryByText('Protected queue')).toBeNull();expect(sessionCalls(t.fetcher)).toHaveLength(3);
 });
 it('does not check a hidden workspace hourly, and refuses expired workspace entry before GET',async()=>{
  vi.useFakeTimers();const start=Date.now(),value={authenticated:true,csrf_token:'same',expires_at:new Date(start+7200000).toISOString()};const fetcher=vi.fn<typeof fetch>(async()=>Response.json(value));render(<OperatorDashboard fetcher={fetcher}/>);await drain();await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(fetcher).toHaveBeenCalledTimes(1);vi.setSystemTime(start+7200000);fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.queryByText('Protected queue')).toBeNull();
 });
});
it('absolute expiry closes a rejected wallet request even when its expiry timer is delayed',async()=>{
 vi.useFakeTimers();const start=Date.now(),wallet=deferred<Response>(),value={authenticated:true,csrf_token:'fixed',expires_at:new Date(start+7200000).toISOString()};
 const fetcher=vi.fn<typeof fetch>(async url=>String(url).includes('session')?Response.json(value):wallet.promise);
 render(<OperatorDashboard fetcher={fetcher}/>);await drain();fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(walletCalls(fetcher)).toHaveLength(1);vi.setSystemTime(start+7200000);wallet.reject(Error('synthetic failure'));await drain();expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Session expired');
});

it('automatically observes after verified entry and skips inside-window view switches',async()=>{
 vi.useFakeTimers();const expires_at=new Date(Date.now()+7200000).toISOString(),fetcher=vi.fn<typeof fetch>(async url=>String(url).includes('session')?Response.json({authenticated:true,csrf_token:'same',expires_at}):Response.json({amount:'12',asset:'USDC',network:'SYNTHETIC',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'}));
 render(<OperatorDashboard fetcher={fetcher}/>);await drain();expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/balance/'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/balance/'))).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));await drain();expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/balance/'))).toHaveLength(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(4999);});expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/balance/'))).toHaveLength(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(walletCalls(fetcher)).toHaveLength(1);await act(async()=>{await vi.advanceTimersByTimeAsync(25000);});expect(walletCalls(fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));await drain();expect(walletCalls(fetcher)).toHaveLength(2);
});

const observed=()=>Response.json({amount:'12',asset:'USDC',network:'SYNTHETIC',captured_at:new Date().toISOString(),verification:'READ_ONLY_BALANCE'});
async function walletFixture(reply:(n:number,init?:RequestInit)=>Promise<Response>,hourlyStatus=200){
 vi.useFakeTimers();const start=Date.now(),value={authenticated:true,csrf_token:'display-csrf',expires_at:new Date(start+7200000).toISOString()};let n=0,sessions=0;
 const fetcher=vi.fn<typeof fetch>(async(url,init)=>{if(url==='/api/operator/session'){sessions++;return Response.json(sessions>2&&hourlyStatus!==200?{code:'SESSION_REQUIRED'}:value,{status:sessions>2?hourlyStatus:200});}if(url==='/api/operator/logout')return Response.json({revoked:true});return reply(++n,init);});
 const r=render(<OperatorDashboard fetcher={fetcher}/>);await drain();expect(walletCalls(fetcher)).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();return {...r,fetcher,start};
}
function hideBoundary(boundary:string,unmount:()=>void){if(boundary==='logout'){fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));}else if(boundary==='unmount')unmount();else{const e=new Event(boundary==='restore'?'pageshow':'pagehide');Object.defineProperty(e,'persisted',{value:true});fireEvent(window,e);}}
describe('one wallet display/manual dispatch gate',()=>{
 it('skips in-flight and cooldown intents with no overlap or deferred catch-up',async()=>{
  const first=deferred<Response>();const t=await walletFixture(n=>n===1?first.promise:Promise.resolve(observed()));expect(walletCalls(t.fetcher)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));expect(walletCalls(t.fetcher)[0][1]!.signal!.aborted).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});first.resolve(observed());await drain();
  fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await act(async()=>{await vi.advanceTimersByTimeAsync(26999);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(walletCalls(t.fetcher)).toHaveLength(2);
  for(const [url,init]of walletCalls(t.fetcher)){expect(url).toBe('/api/wallet/balance/refresh');expect(init).toMatchObject({method:'POST',cache:'no-store',credentials:'same-origin',headers:{'X-Tameion-CSRF':'display-csrf'},body:'{}'});}
 });
 it.each(['seconds','date','malformed-body'])('honors Retry-After %s, consuming failure without retry until another display',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(Math.floor(Date.now()/1000)*1000);const until=new Date(Date.now()+60000).toUTCString();const t=await walletFixture(async n=>n===1?new Response(kind==='malformed-body'?'bad':JSON.stringify({code:'RATE_LIMITED'}),{status:429,headers:{'Retry-After':kind==='date'?until:'60'}}):observed());
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(walletCalls(t.fetcher)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));await act(async()=>{await vi.advanceTimersByTimeAsync(49999);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(walletCalls(t.fetcher)).toHaveLength(2);
 });
 it('does not retry a failed display on rerender, but accepts a later explicit manual intent',async()=>{
  const t=await walletFixture(async()=>{throw Error('synthetic network failure');});await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(walletCalls(t.fetcher)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(walletCalls(t.fetcher)).toHaveLength(2);
 });
 it.each(['logout','pagehide','restore','unmount','expiry','hourly-denial'])('never reschedules a skipped display after %s',async boundary=>{
  const t=await walletFixture(async()=>new Response(JSON.stringify({code:'RATE_LIMITED'}),{status:429,headers:{'Retry-After':'8000'}}),boundary==='hourly-denial'?401:200);
  fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));
  if(boundary==='expiry'||boundary==='hourly-denial')await act(async()=>{await vi.advanceTimersByTimeAsync(boundary==='expiry'?7200000:3600000);});else hideBoundary(boundary,t.unmount);
  await act(async()=>{await vi.advanceTimersByTimeAsync(9000000);});expect(walletCalls(t.fetcher)).toHaveLength(1);expect(screen.queryByText('Protected queue')).toBeNull();
 });
 it.each(['logout','pagehide','restore','unmount','expiry','hourly-denial'])('aborts in-flight display and discards ignored-abort late balance on %s',async boundary=>{
  const late=deferred<Response>(),t=await walletFixture(()=>late.promise,boundary==='hourly-denial'?401:200);localStorage.setItem('tameion.assessment-request.SYNTHETIC','same-key');
  if(boundary==='expiry'||boundary==='hourly-denial')await act(async()=>{await vi.advanceTimersByTimeAsync(boundary==='expiry'?7200000:3600000);});else hideBoundary(boundary,t.unmount);
  expect(walletCalls(t.fetcher)[0][1]!.signal!.aborted).toBe(true);late.resolve(observed());await drain();expect(screen.queryByText('Protected queue')).toBeNull();expect(screen.queryByText('12.00 USDC')).toBeNull();expect(walletCalls(t.fetcher)).toHaveLength(1);expect(localStorage.getItem('tameion.assessment-request.SYNTHETIC')).toBe('same-key');localStorage.removeItem('tameion.assessment-request.SYNTHETIC');
 });
 it('refuses a new display after absolute expiry even with delayed expiry timers',async()=>{
  const t=await walletFixture(async()=>observed());fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));vi.setSystemTime(t.start+7200000);fireEvent.click(screen.getByRole('button',{name:'Mock Dashboard'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);expect(screen.queryByText('Protected queue')).toBeNull();
 });
});

it('thirty-second policy skips a display within30 without deferred catch-up',async()=>{
 const t=await walletFixture(async()=>observed());await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(25000);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
});
it('persists only cooldown timestamps before display dispatch',async()=>{
 const metadata:(string|null)[]=[];const t=await walletFixture(async()=>{metadata.push(sessionStorage.getItem('tameion.wallet-cooldown.v1'));return observed();});
 expect(walletCalls(t.fetcher)).toHaveLength(1);expect(metadata[0]).not.toBeNull();expect(Object.keys(JSON.parse(metadata[0]!)).sort()).toEqual(['cooldownUntil','lastAttempt','version']);
});

describe('untrusted cooldown continuity',()=>{
 it('enforces exact29.999/30 dispatch spacing without a timer-triggered send',async()=>{
  const t=await walletFixture(async()=>observed());await act(async()=>{await vi.advanceTimersByTimeAsync(29999);});fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
 });
 it('persists before fetch once, suppresses a reload read, and never restores a stored balance',async()=>{
  const spy=vi.spyOn(Storage.prototype,'setItem'),t=await walletFixture(async()=>observed());const metadata=sessionStorage.getItem('tameion.wallet-cooldown.v1');expect(screen.getByText('12.00 USDC')).toBeTruthy();t.unmount();
  render(<OperatorDashboard fetcher={t.fetcher}/>);await drain();fireEvent.click(screen.getByRole('button',{name:'Open workspace'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);expect(screen.queryByText('12.00 USDC')).toBeNull();expect(screen.getByRole('status').textContent).toContain('No balance observed in this view');expect(sessionStorage.getItem('tameion.wallet-cooldown.v1')).toBe(metadata);
  expect(spy.mock.calls.filter(([key])=>key==='tameion.wallet-cooldown.v1')).toHaveLength(1);const parsed=JSON.parse(metadata!);expect(parsed).toEqual({version:1,lastAttempt:t.start,cooldownUntil:t.start+30000});
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(walletCalls(t.fetcher)).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Mock workflow'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
 });
 it.each(['{','null','{}','{"version":2,"lastAttempt":1,"cooldownUntil":30001}',JSON.stringify({version:1,lastAttempt:Date.now()+999999,cooldownUntil:Date.now()+1029999}),JSON.stringify({version:1,lastAttempt:1,cooldownUntil:2}),JSON.stringify({version:1,lastAttempt:1,cooldownUntil:Number.MAX_SAFE_INTEGER})])('consumes malformed/future metadata %s without a balance read',async metadata=>{
  sessionStorage.setItem('tameion.wallet-cooldown.v1',metadata);const t=await walletFixture(async()=>observed());expect(walletCalls(t.fetcher)).toHaveLength(0);expect(screen.getByRole('status').textContent).toContain('cooldown metadata could not be verified');await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(walletCalls(t.fetcher)).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);
 });
 it.each(['read','write','silent-write'])('suppresses POST when cooldown storage %s fails',async mode=>{
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
  if(mode==='read')vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){if(key==='tameion.wallet-cooldown.v1')throw Error('denied');return get.call(this,key);});
  else vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key==='tameion.wallet-cooldown.v1'){if(mode==='write')throw Error('denied');return;}return set.call(this,key,value);});
  const t=await walletFixture(async()=>observed());expect(walletCalls(t.fetcher)).toHaveLength(0);expect(screen.getByRole('status').textContent).toContain('No balance request was sent');await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(walletCalls(t.fetcher)).toHaveLength(0);
 });
 it('a forward wallclock jump cannot shorten the mounted monotonic cooldown',async()=>{
  const t=await walletFixture(async()=>observed());const stamp=screen.getByRole('region',{name:'Read-only wallet balance'}).querySelector('time')!.dateTime;await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});vi.setSystemTime(t.start+3600000);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);expect(screen.getByRole('region',{name:'Read-only wallet balance'}).querySelector('time')!.dateTime).toBe(stamp);
  await act(async()=>{await vi.advanceTimersByTimeAsync(19999);});fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);await act(async()=>{await vi.advanceTimersByTimeAsync(1);});fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(2);
 });
 it('backward-clock/future metadata consumes the event and logout preserves timestamps while clearing balance',async()=>{
  const t=await walletFixture(async()=>observed());vi.setSystemTime(t.start-1000);fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));await drain();expect(walletCalls(t.fetcher)).toHaveLength(1);expect(screen.getByRole('status').textContent).toContain('cooldown metadata could not be verified');const metadata=sessionStorage.getItem('tameion.wallet-cooldown.v1');fireEvent.click(screen.getByText('User',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Log out'}));await drain();expect(screen.queryByText('12.00 USDC')).toBeNull();expect(sessionStorage.getItem('tameion.wallet-cooldown.v1')).toBe(metadata);
 });
});
