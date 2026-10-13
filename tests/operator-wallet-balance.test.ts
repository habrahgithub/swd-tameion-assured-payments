import {createHash} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {circleBalanceCapability,readOperatorBalance,readPinnedBalance,type BalancePin} from '../src/server/operator-wallet-balance';

const tokenId='MOCK-NATIVE-TOKEN';
const pin:BalancePin={
 wallet_id:'MOCK-W',wallet_set_id:'MOCK-SET',source_address:'0x'+'1'.repeat(40),network:'ARC-TESTNET',
 token_id_sha256:createHash('sha256').update(tokenId).digest('hex'),token_address_sha256:null,decimals:18,native:true,
};
const terminalHeaders:Record<string,string>={link:'<private-first>; rel="first", <private-self>; rel="self"'};
function fixture(){return {
 getWallet:vi.fn(async()=>({data:{wallet:{id:pin.wallet_id,walletSetId:pin.wallet_set_id,address:pin.source_address,blockchain:pin.network,state:'LIVE'}}})),
 getWalletTokenBalance:vi.fn(async()=>({headers:terminalHeaders,data:{tokenBalances:[
  {amount:'12.345678000000000000',token:{id:tokenId,tokenAddress:undefined,blockchain:pin.network,decimals:18,symbol:'USDC',isNative:true}},
  {amount:'9.123456',token:{id:'MOCK-ERC20',tokenAddress:'0x'+'2'.repeat(40),blockchain:pin.network,decimals:6,symbol:'USDC',isNative:false,standard:'ERC20'}},
 ]}})),
};}

describe('pinned read-only balance',()=>{
 it('selects the exact native Arc USDC identity from a terminal collection',async()=>{
  const client=fixture(),valid=vi.fn(async()=>{}),factory=vi.fn(()=>client);const result=await readPinnedBalance(pin,factory,valid);
  expect(result).toMatchObject({amount:'12.345678000000000000',asset:'USDC',network:'ARC-TESTNET',verification:'READ_ONLY_BALANCE'});
  expect(factory).toHaveBeenCalledOnce();expect(valid).toHaveBeenCalledTimes(4);
  expect(client.getWalletTokenBalance).toHaveBeenCalledWith(pin.wallet_id);
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
  ['next','<private>; rel="first", <private>; rel="self", <private-cursor>; rel="next"'],
  ['unknown','<private>; rel="self", <private>; rel="custom"'],
  ['unparseable','<private-cursor>'],
  ['partially unparseable','<private>; rel="first", <private>; rel="self", <private-without-relation>'],
  ['missing',undefined],
 ] as const)('rejects %s collection-completeness evidence',async(_name,link)=>{
  const client=fixture(),value=await client.getWalletTokenBalance();value.headers=link===undefined?{}:{link};client.getWalletTokenBalance.mockResolvedValueOnce(value);
  await expect(readPinnedBalance(pin,()=>client,async()=>{})).rejects.toMatchObject({code:'BALANCE_NOT_VERIFIED'});
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
