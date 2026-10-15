import {createHash} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {circleBalanceCapability,readOperatorBalance,readPinnedBalance,type BalancePin} from '../src/server/operator-wallet-balance';
import * as walletBalance from '../src/server/operator-wallet-balance';

const tokenId='MOCK-NATIVE-TOKEN';
const pin:BalancePin={
 wallet_id:'MOCK-W',wallet_set_id:'MOCK-SET',source_address:'0x'+'1'.repeat(40),network:'ARC-TESTNET',
 token_id_sha256:createHash('sha256').update(tokenId).digest('hex'),token_address_sha256:null,decimals:18,native:true,
};
const terminalHeaders:Record<string,string>={link:'<private-first>; rel="first", <private-self>; rel="self"'};

describe('configuration-only pin validation',()=>{
 it('exposes a pure predicate over the existing strict pin schema',()=>{
  expect(walletBalance.isBalancePinValid).toBeTypeOf('function');
  expect(walletBalance.isBalancePinValid(JSON.stringify(pin))).toBe(true);
 });
 it.each([undefined,'','{','null','[]','{}',JSON.stringify({...pin,decimals:6}),JSON.stringify({...pin,unexpected:'not-admitted'})])('rejects absent or invalid pins without exposing validation detail (%#)',raw=>{
  expect(walletBalance.isBalancePinValid(raw)).toBe(false);
 });
});
function fixture(){return {
 getWallet:vi.fn(async()=>({data:{wallet:{id:pin.wallet_id,walletSetId:pin.wallet_set_id,address:pin.source_address,blockchain:pin.network,state:'LIVE'}}})),
 getWalletTokenBalance:vi.fn(async(_id?:string,_pageAfter?:string)=>({headers:terminalHeaders,data:{tokenBalances:[
  {amount:'12.345678000000000000',token:{id:tokenId,tokenAddress:undefined,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}},
  {amount:'9.123456',token:{id:'MOCK-ERC20',tokenAddress:'0x'+'2'.repeat(40),blockchain:pin.network,decimals:6,symbol:'USDC',isNative:false,standard:'ERC20'}},
 ]}})),
};}

describe('pinned read-only balance',()=>{
 it('selects the exact native Arc USDC identity from a terminal collection',async()=>{
  const client=fixture(),valid=vi.fn(async()=>{}),factory=vi.fn(()=>client);const result=await readPinnedBalance(pin,factory,valid);
  expect(result).toMatchObject({amount:'12.345678000000000000',asset:'USDC',network:'ARC-TESTNET',verification:'READ_ONLY_BALANCE'});
  expect(factory).toHaveBeenCalledOnce();expect(valid).toHaveBeenCalledTimes(4);
  expect(client.getWalletTokenBalance).toHaveBeenCalledWith(pin.wallet_id,undefined);
 });
 it.each(['0','0.1','12.345678000000000000'])('accepts canonical native-18 decimal %s',async amount=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.data.tokenBalances[0].amount=amount;client.getWalletTokenBalance.mockResolvedValueOnce(value);
  expect((await readPinnedBalance(pin,()=>client,async()=>{})).amount).toBe(amount);
 });
 it.each(['000.1','-1','1e6','1.0000000000000000001','NaN',''])('rejects malformed native-18 decimal %s',async amount=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.data.tokenBalances[0].amount=amount;client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
 });
 it('rejects duplicate exact native identity while allowing distinct ERC-20 USDC',async()=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.data.tokenBalances.push({...value.data.tokenBalances[0]});client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
 });
 it.each([
  ['id',{id:'OTHER'}],['network',{blockchain:'ETH-SEPOLIA'}],['decimals',{decimals:6}],['native',{isNative:false}],['address',{tokenAddress:'0x'+'3'.repeat(40)}],
 ] as const)('rejects pinned-token %s mismatch',async(_name,change)=>{
  const client=fixture(),value=await client.getWalletTokenBalance();Object.assign(value.data.tokenBalances[0].token,change);client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
 });
 it.each([
  ['unknown','<private>; rel="self", <private>; rel="custom"'],
  ['unparseable','<private-cursor>'],
  ['partially unparseable','<private>; rel="first", <private>; rel="self", <private-without-relation>'],
  ['missing',undefined],
 ] as const)('rejects %s collection-completeness evidence',async(_name,link)=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.headers=link===undefined?{}:{link};client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
 });
 it('follows every advertised page and selects the single pinned token across the complete result',async()=>{
  const client=fixture();
  client.getWalletTokenBalance
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-1>; rel="next", <https://api.circle.com/v1/w3s/wallets/W/balances>; rel="first", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[{amount:'1.25',token:{id:'OTHER-1',blockchain:pin.network,decimals:18,symbol:'ETH',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>)
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/v1/w3s/wallets/W/balances>; rel="first", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-1>; rel="prev", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-2>; rel="next", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[{amount:'12.345678',token:{id:tokenId,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>)
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/v1/w3s/wallets/W/balances>; rel="first", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-2>; rel="prev", <https://api.circle.com/v1/w3s/wallets/W/balances?pageAfter=cursor-2>; rel="self"'},data:{tokenBalances:[{amount:'4.5',token:{id:'OTHER-2',blockchain:pin.network,decimals:18,symbol:'ETH',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).resolves.toMatchObject({amount:'12.345678'});
  expect(client.getWalletTokenBalance.mock.calls).toEqual([[pin.wallet_id,undefined],[pin.wallet_id,'cursor-1'],[pin.wallet_id,'cursor-2']]);
 });
 it('rejects duplicate token identities across pages',async()=>{
  const repeated=fixture();
  repeated.getWalletTokenBalance
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/balances?pageAfter=cursor-1>; rel="next", <https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[{amount:'12.3',token:{id:tokenId,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof repeated.getWalletTokenBalance>>)
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=cursor-1>; rel="prev", <https://api.circle.com/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[{amount:'12.3',token:{id:tokenId,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof repeated.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>repeated,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
  expect(repeated.getWalletTokenBalance).toHaveBeenCalledTimes(2);
 });
 it('rejects repeated pagination cursors without making another request',async()=>{
  const client=fixture();
  client.getWalletTokenBalance
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/balances?pageAfter=cursor-1>; rel="next", <https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>)
   .mockResolvedValueOnce({headers:{link:'<https://api.circle.com/balances?pageAfter=cursor-1>; rel="next", <https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=cursor-1>; rel="self"'},data:{tokenBalances:[]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
  expect(client.getWalletTokenBalance).toHaveBeenCalledTimes(2);
 });
 it('rejects disagreement between body and Link pagination cursors',async()=>{
  const client=fixture();
  client.getWalletTokenBalance.mockResolvedValueOnce({headers:{link:'<https://api.circle.com/balances?pageAfter=link-cursor>; rel="next", <https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=link-cursor>; rel="self"'},data:{tokenBalances:[],pagination:{nextPageAfter:'body-cursor'}}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
  expect(client.getWalletTokenBalance).toHaveBeenCalledOnce();
 });
 it('stops after the bounded page budget when Circle keeps advertising more pages',async()=>{
  const client=fixture();let count=0;
  client.getWalletTokenBalance.mockImplementation(async(_id,pageAfter)=>{
   count++;const next=`cursor-${count}`;
   return {headers:{link:`<https://api.circle.com/balances?pageAfter=${next}>; rel="next", <https://api.circle.com/balances>; rel="first", <https://api.circle.com/balances?pageAfter=${pageAfter??''}>; rel="self"`},data:{tokenBalances:[{amount:'1',token:{id:`OTHER-${count}`,blockchain:pin.network,decimals:18,symbol:'ETH',isNative:true}}]}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>;
  });
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
  expect(client.getWalletTokenBalance).toHaveBeenCalledTimes(20);
 });
 it('accepts an explicit nextPageAfter cursor and null terminal cursor when Link headers are absent',async()=>{
  const client=fixture();
  client.getWalletTokenBalance
   .mockResolvedValueOnce({headers:{},data:{tokenBalances:[],pagination:{nextPageAfter:'body-cursor'}}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>)
   .mockResolvedValueOnce({headers:{},data:{tokenBalances:[{amount:'12.3',token:{id:tokenId,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}}],pagination:{nextPageAfter:null}}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).resolves.toMatchObject({amount:'12.3'});
  expect(client.getWalletTokenBalance.mock.calls).toEqual([[pin.wallet_id,undefined],[pin.wallet_id,'body-cursor']]);
 });
 it.each([{}, {nextPageAfter:undefined}])('rejects an ambiguous Circle pagination object %s',async pagination=>{
  const client=fixture();
  client.getWalletTokenBalance.mockResolvedValueOnce({headers:{},data:{tokenBalances:[
   {amount:'12.3',token:{id:tokenId,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}},
  ],pagination}} as unknown as Awaited<ReturnType<typeof client.getWalletTokenBalance>>);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
  expect(client.getWalletTokenBalance).toHaveBeenCalledOnce();
 });
 it('rejects malformed unrelated rows rather than hiding provider ambiguity',async()=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.data.tokenBalances[1].amount='NaN';client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
 });
 it('rejects wallet mismatch before token read',async()=>{
  const client=fixture();client.getWallet.mockResolvedValueOnce({data:{wallet:{id:'WRONG',walletSetId:pin.wallet_set_id,address:pin.source_address,blockchain:pin.network,state:'LIVE'}}});
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});expect(client.getWalletTokenBalance).not.toHaveBeenCalled();
 });
 it('preserves session revocation between provider reads',async()=>{
  const client=fixture(),valid=vi.fn(async()=>{});valid.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
  await expect(readPinnedBalance(pin,()=>client,valid)).rejects.toThrow();expect(client.getWalletTokenBalance).not.toHaveBeenCalled();
 });
});

describe('supported SDK capability',()=>{
 it('exposes only the two bounded reads with exact balance request parameters',async()=>{
  const sdk={getWallet:vi.fn(async()=>({data:{wallet:{}}})),getWalletTokenBalance:vi.fn(async()=>({data:{tokenBalances:[]}})),createTransaction:vi.fn()};
  const capability=circleBalanceCapability('TEST_API_KEY:ID:SECRET',()=>sdk);
  expect(Object.keys(capability).sort()).toEqual(['getWallet','getWalletTokenBalance']);
  await capability.getWallet('W');await capability.getWalletTokenBalance('W');
  expect(sdk.getWallet).toHaveBeenCalledWith({id:'W'});
  expect(sdk.getWalletTokenBalance).toHaveBeenCalledWith({id:'W',includeAll:true,pageSize:50});
  expect(sdk.createTransaction).not.toHaveBeenCalled();
 });
});

describe('hosted balance contract',()=>{
 afterEach(()=>{vi.unstubAllEnvs();});
 it('fails before client creation when the server pin is absent',async()=>{
  vi.stubEnv('TAMEION_BALANCE_PIN','');vi.stubEnv('CIRCLE_API_KEY','SYNTHETIC_NETWORK_DENIED');const valid=vi.fn(async()=>{});
  await expect(readOperatorBalance(valid)).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED',status:503});expect(valid).toHaveBeenCalledOnce();
 });
 it('preserves session revocation before configuration or provider access',async()=>{
  const {AccessError}=await import('../src/server/route-access-policy');const revoked=new AccessError('SESSION_REQUIRED',401);
  await expect(readOperatorBalance(async()=>{throw revoked;})).rejects.toBe(revoked);
 });
});
