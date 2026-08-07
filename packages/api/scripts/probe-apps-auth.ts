// One-off, read-only probe: log into stageautomation, then GET apps.heartpace.dev with various
// credential combinations (incl. the captured x-site-uuid / x-subdomain) to learn what it needs.
import { request } from '@playwright/test';
import fs from 'node:fs';
import { parseHarInputs } from '../src/har/parser.js';

function readEnv(name: string): string {
  if (process.env[name]) {
    return process.env[name] as string;
  }
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === name) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return v;
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

const LOGIN = 'https://stageautomation.heartpace.dev/auth/main/login';
const APPS = 'https://apps.heartpace.dev/v1/navigation/top';

function header(headers: { name: string; value: string }[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function tokenFrom(b: any): string | undefined {
  return b?.response?.data?.token ?? b?.response?.token ?? b?.data?.token ?? b?.accessToken ?? b?.token;
}

async function main(): Promise<void> {
  // 1. Pull the real tenant headers an apps request used, from the capture.
  const entries = await parseHarInputs(['examples']);
  const appsReq = entries.find(
    (e) => e.request.url.startsWith('https://apps.heartpace.dev') && header(e.request.headers, 'x-site-uuid')
  );
  const siteUuid = header(appsReq?.request.headers, 'x-site-uuid');
  const subdomain = header(appsReq?.request.headers, 'x-subdomain');
  console.log('from capture -> x-site-uuid:', siteUuid ? `present (${siteUuid.length} chars)` : 'NONE', '| x-subdomain:', subdomain ?? 'NONE');

  const email = readEnv('TEST_EMAIL');
  const password = readEnv('TEST_PASSWORD');
  if (!email || !password) {
    console.error('Missing TEST_EMAIL / TEST_PASSWORD');
    process.exit(1);
  }

  // 2. Log in.
  const ctx = await request.newContext({
    ignoreHTTPSErrors: process.env.API_IGNORE_HTTPS_ERRORS === 'true'
  });
  const login = await ctx.fetch(LOGIN, {
    method: 'POST',
    headers: { accept: 'application/json, text/plain, */*', 'content-type': 'application/json' },
    data: { email, password }
  });
  console.log('login status:', login.status());
  const body = await login.json().catch(() => undefined);
  const token = tokenFrom(body);
  const cookieHeader = login
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
  console.log('captured -> token:', Boolean(token), '| cookie:', Boolean(cookieHeader));
  console.log('');

  async function probe(label: string, headers: Record<string, string>): Promise<void> {
    const c = await request.newContext({
      ignoreHTTPSErrors: process.env.API_IGNORE_HTTPS_ERRORS === 'true'
    });
    const r = await c.fetch(APPS, {
      method: 'GET',
      headers: { accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest', ...headers }
    });
    console.log(`  ${label.padEnd(34)} -> ${r.status()}`);
    await c.dispose();
  }

  const tenant: Record<string, string> = {};
  if (siteUuid) tenant['x-site-uuid'] = siteUuid;
  if (subdomain) tenant['x-subdomain'] = subdomain;

  console.log(APPS);
  await probe('(0) no auth', {});
  if (cookieHeader) await probe('(a) cookie only', { cookie: cookieHeader });
  await probe('(e) tenant only (uuid+subdomain)', tenant);
  if (cookieHeader) await probe('(f) cookie + tenant', { cookie: cookieHeader, ...tenant });
  if (token) await probe('(g) bearer + tenant', { authorization: 'Bearer ' + token, ...tenant });
  if (cookieHeader && token) await probe('(h) cookie + bearer + tenant', { cookie: cookieHeader, authorization: 'Bearer ' + token, ...tenant });

  await ctx.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
