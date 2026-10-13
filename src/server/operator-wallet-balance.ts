import {createHash} from 'node:crypto';
import axios from 'axios';
import {initiateDeveloperControlledWalletsClient} from '@circle-fin/developer-controlled-wallets';
import {z} from 'zod';
import {AccessError} from './route-access-policy';

const pinSchema=z.object({
 wallet_id:z.string().min(1).max(128),wallet_set_id:z.string().min(1).max(128),source_address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),network:z.literal('ARC-TESTNET'),
 token_id_sha256:z.string().regex(/^[a-f0-9]{64}$/),token_address_sha256:z.null(),decimals:z.literal(18),native:z.literal(true),
}).strict();
export type BalancePin=z.infer<typeof pinSchema>;

export interface ReadOnlyBalanceCapability {getWallet:(walletId:string)=>Promise<unknown>;getWalletTokenBalance:(walletId:string,pageAfter?:string)=>Promise<unknown>}
interface CircleSdkReads {getWallet:(input:{id:string})=>Promise<unknown>;getWalletTokenBalance:(input:{id:string;includeAll:true;pageSize:50;pageAfter?:string})=>Promise<unknown>}
type CircleSdkInitializer=(apiKey:string)=>CircleSdkReads;

const walletSchema=z.object({data:z.object({wallet:z.object({id:z.string(),walletSetId:z.string(),address:z.string(),blockchain:z.string(),state:z.literal('LIVE')})})});
const balancesSchema=z.object({
 headers:z.unknown(),
 data:z.object({tokenBalances:z.array(z.object({
  amount:z.string().max(80).regex(/^(0|[1-9]\d*)(\.\d+)?$/),
  token:z.object({id:z.string(),tokenAddress:z.string().nullable().optional(),blockchain:z.string(),decimals:z.number(),symbol:z.string(),isNative:z.boolean()}),
 })).max(50),pagination:z.object({nextPageAfter:z.string().min(1).max(2048).nullable().optional()}).passthrough().optional()}),
});

function defaultSdk(apiKey:string):CircleSdkReads{
 // The installed SDK uses this shared axios instance. Bound all SDK reads to the
 // reviewed timeout and forbid redirect-created second requests.
 axios.defaults.timeout=5000;axios.defaults.maxRedirects=0;
 return initiateDeveloperControlledWalletsClient({apiKey,userAgent:'TameionReadOnlyBalance/1'} as Parameters<typeof initiateDeveloperControlledWalletsClient>[0]);
}

/** A deliberately narrow view of the supported Circle SDK. It exposes no
 * signing, transaction, wallet-creation, faucet or fee-estimation methods. */
export function circleBalanceCapability(apiKey:string,initialize:CircleSdkInitializer=defaultSdk):ReadOnlyBalanceCapability{
 if(!apiKey)throw new AccessError('BALANCE_NOT_VERIFIED',503);const client=initialize(apiKey);
 return Object.freeze({
  getWallet:(id:string)=>client.getWallet({id}),
  getWalletTokenBalance:(id:string,pageAfter?:string)=>client.getWalletTokenBalance({id,includeAll:true,pageSize:50,...(pageAfter?{pageAfter}:{})}),
 });
}

function sha256(value:string){return createHash('sha256').update(value).digest('hex');}
function linkValue(headers:unknown):unknown{
 if(!headers||typeof headers!=='object')return undefined;
 const get=(headers as {get?:unknown}).get;if(typeof get==='function')return (get as (name:string)=>unknown).call(headers,'link');
 const key=Object.keys(headers).find(name=>name.toLowerCase()==='link');return key===undefined?undefined:(headers as Record<string,unknown>)[key];
}
function linkPageAfter(headers:unknown):{present:boolean;next:string|null}{
 const raw=linkValue(headers),values=Array.isArray(raw)?raw:typeof raw==='string'?[raw]:[];
 if(values.length===0)return {present:false,next:null};
 if(values.some(value=>typeof value!=='string'||value.length===0))throw new Error();
 const observed:Array<{rel:string;url:string}>=[];
 for(const part of values.join(',').split(/,\s*(?=<)/)){
  const match=part.match(/^\s*<([^<>\r\n]+)>\s*;\s*rel\s*=\s*(?:"([A-Za-z][A-Za-z0-9_-]*)"|([A-Za-z][A-Za-z0-9_-]*))\s*$/i);
  if(!match)throw new Error();observed.push({url:match[1],rel:String(match[2]||match[3]).toLowerCase()});
 }
 const allowed=new Set(['next','prev','previous','first','last','self']);
 if(observed.length===0||observed.some(value=>!allowed.has(value.rel))||!observed.some(value=>value.rel==='first')||!observed.some(value=>value.rel==='self'))throw new Error();
 const next=observed.filter(value=>value.rel==='next');if(next.length>1)throw new Error();
 if(next.length===0)return {present:true,next:null};
 const url=new URL(next[0].url,'https://api.circle.com');const cursors=url.searchParams.getAll('pageAfter');
 if(cursors.length!==1||!cursors[0]||cursors[0].length>2048)throw new Error();
 return {present:true,next:cursors[0]};
}
function nextPageAfter(response:{headers:unknown;data:{pagination?:{nextPageAfter?:string|null}}}):string|null{
 const fromLink=linkPageAfter(response.headers),fromBody=response.data.pagination;
 const bodyPresent=fromBody!==undefined,bodyNext=fromBody?.nextPageAfter??null;
 if(bodyPresent&&fromBody?.nextPageAfter!==undefined&&fromBody.nextPageAfter!==null&&typeof fromBody.nextPageAfter!=='string')throw new Error();
 if(fromLink.present&&bodyPresent&&fromLink.next!==bodyNext)throw new Error();
 if(fromLink.present)return fromLink.next;
 if(bodyPresent)return bodyNext;
 throw new Error();
}

export async function readPinnedBalance(pin:BalancePin,factory:()=>ReadOnlyBalanceCapability,revalidate:()=>Promise<void>){
 try{
  pinSchema.parse(pin);await revalidate();const client=factory();
  const wallet=walletSchema.parse(await client.getWallet(pin.wallet_id)).data.wallet;
  await revalidate();
  if(wallet.id!==pin.wallet_id||wallet.walletSetId!==pin.wallet_set_id||wallet.address.toLowerCase()!==pin.source_address.toLowerCase()||wallet.blockchain!==pin.network)throw new Error();
  const rows: z.infer<typeof balancesSchema>['data']['tokenBalances']=[],seenCursors=new Set<string>(),seenTokenIds=new Set<string>();
  let pageAfter:string|undefined;
  for(let page=0;page<20;page++){
   await revalidate();const response=balancesSchema.parse(await client.getWalletTokenBalance(pin.wallet_id,pageAfter));await revalidate();
   for(const row of response.data.tokenBalances){if(seenTokenIds.has(row.token.id))throw new Error();seenTokenIds.add(row.token.id);rows.push(row);}
   const next=nextPageAfter(response);
   if(next===null)break;
   if(page===19||seenCursors.has(next))throw new Error();seenCursors.add(next);pageAfter=next;
  }
  const matches=rows.filter(row=>sha256(row.token.id)===pin.token_id_sha256);
  if(matches.length!==1)throw new Error();const row=matches[0],token=row.token;
  if(token.tokenAddress!=null||pin.token_address_sha256!==null||token.blockchain!==pin.network||token.decimals!==pin.decimals||token.symbol!=='USDC'||token.isNative!==pin.native)throw new Error();
  if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(row.amount))throw new Error();
  return {amount:row.amount,asset:'USDC' as const,captured_at:new Date().toISOString(),network:pin.network,verification:'READ_ONLY_BALANCE' as const};
 }catch(error){if(error instanceof AccessError&&error.code==='SESSION_REQUIRED')throw error;throw new AccessError('BALANCE_NOT_VERIFIED',503);}
}

export async function readOperatorBalance(revalidate:()=>Promise<void>):Promise<Awaited<ReturnType<typeof readPinnedBalance>>>{
 await revalidate();let pin:BalancePin;
 try{pin=pinSchema.parse(JSON.parse(process.env.TAMEION_BALANCE_PIN??'null'));}catch{throw new AccessError('BALANCE_NOT_VERIFIED',503);}
 return readPinnedBalance(pin,()=>circleBalanceCapability(process.env.CIRCLE_API_KEY??''),revalidate);
}
