import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=resolve(import.meta.dirname,'..');

describe('temporary wallet configuration diagnostic removal',()=>{
 it('does not expose the completed configuration probe as an API route',()=>{
  expect(existsSync(resolve(root,'app/api/operator/diagnostics/wallet-config/route.ts'))).toBe(false);
 });
});
