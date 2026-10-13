import {z} from 'zod';
import {AccessError} from './route-access-policy';
const pinSchema=z.object({wallet_id:z.string().min(1).max(128),wallet_set_id:z.string().min(1).max(128),source_address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),network:z.literal('ARC-TESTNET'),token_id:z.string().min(1).max(128),token_address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),decimals:z.literal(6),native:z.literal(true)}).strict();
export type BalancePin=z.infer<typeof pinSchema>;
export interface ReadOnlyBalanceCapability {getWallet:(walletId:string)=>Promise<unknown>;getWalletTokenBalance:(walletId:string)=>Promise<unknown>}
const walletSchema=z.object({data:z.object({wallet:z.object({id:z.string(),walletSetId:z.string(),address:z.string(),blockchain:z.string(),state:z.literal('LIVE')})})});
const balancesSchema=z.object({data:z.object({tokenBalances:z.array(z.object({amount:z.string().max(80).regex(/^(0|[1-9]\d*)(\.\d+)?$/),token:z.object({id:z.string(),tokenAddress:z.string(),blockchain:z.string(),decimals:z.number(),symbol:z.string(),isNative:z.boolean()})})).max(1000)})});
/** New GET-only client. It has no signing, fee, transaction or creation API,
 * requires no entity secret, uses the pinned Circle API origin, and never retries. */
export function circleBalanceCapability(apiKey:string,fetcher:typeof fetch=fetch):ReadOnlyBalanceCapability {
  if(!apiKey)throw new AccessError('BALANCE_NOT_VERIFIED',503);
  async function get(path:string){const response=await fetcher(`https://api.circle.com/v1/w3s/wallets/${path}`,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}});if(!response.ok)throw new Error('balance unavailable');return response.json();}
  return Object.freeze({getWallet:(id:string)=>get(encodeURIComponent(id)),getWalletTokenBalance:(id:string)=>get(`${encodeURIComponent(id)}/balances`)});
}
export async function readPinnedBalance(pin:BalancePin,factory:()=>ReadOnlyBalanceCapability,revalidate:()=>Promise<void>){
  try {
    pinSchema.parse(pin);await revalidate();const client=factory();
    const wallet=walletSchema.parse(await client.getWallet(pin.wallet_id)).data.wallet;
    await revalidate();
    if(wallet.id!==pin.wallet_id||wallet.walletSetId!==pin.wallet_set_id||wallet.address.toLowerCase()!==pin.source_address.toLowerCase()||wallet.blockchain!==pin.network)throw new Error();
    await revalidate();const rows=balancesSchema.parse(await client.getWalletTokenBalance(pin.wallet_id)).data.tokenBalances;
    // A duplicate identity or a near-match is not a trustworthy balance.
    const matches=rows.filter(r=>r.token.id===pin.token_id||r.token.tokenAddress.toLowerCase()===pin.token_address.toLowerCase()||r.token.symbol==='USDC');
    if(matches.length!==1)throw new Error();const row=matches[0],token=row.token;
    if(token.id!==pin.token_id||token.tokenAddress.toLowerCase()!==pin.token_address.toLowerCase()||token.blockchain!==pin.network||token.decimals!==6||token.symbol!=='USDC'||token.isNative!==pin.native)throw new Error();
    // Precision belongs to the selected pinned asset; unrelated amounts remain bounded canonical decimals.
    if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(row.amount))throw new Error();
    await revalidate();return {amount:row.amount,asset:'USDC' as const,captured_at:new Date().toISOString(),network:pin.network,verification:'READ_ONLY_BALANCE' as const};
  }catch(error){if(error instanceof AccessError&&error.code==='SESSION_REQUIRED')throw error;throw new AccessError('BALANCE_NOT_VERIFIED',503);}
}
export async function readOperatorBalance(revalidate:()=>Promise<void>):Promise<Awaited<ReturnType<typeof readPinnedBalance>>>{
  await revalidate();
  // Circle's collection cursor/terminal contract and Arc token representation are
  // not yet established. A matching first page or configured pin cannot prove
  // a complete verified balance. Keep the hosted path closed before any client
  // construction or provider request; finite injected fixtures are not authority.
  throw new AccessError('BALANCE_NOT_VERIFIED',503);
}
