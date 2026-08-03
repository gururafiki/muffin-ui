// scripts/hydration-check.mjs — run: node scripts/hydration-check.mjs
// Env: SUPABASE_ANON_KEY (optional — enables the accounts code path).
// Requires system Chrome + puppeteer-core + a fresh `npx expo export -p web --output-dir dist`.
//
// Diagnoses the React #418 hydration mismatch by visiting every route under BOTH
// colour schemes and reporting, per route, which prerendered HTML the nginx-style
// `try_files $uri $uri.html /index.html` rule actually served.
//
// Findings this produced (2026-08-02):
//   - #418 counts are IDENTICAL in light and dark on all 18 routes, so the mismatch
//     is NOT colour-scheme related (which is why routing useColorScheme through
//     `@/hooks/use-color-scheme` was NOT done).
//   - Every route served by the `spa-fallback` branch fires exactly one #418.
//     Expo emits per-route prerenders for dynamic routes with LITERAL BRACKETS in
//     the filename (`dist/stock/[ticker].html`), which `try_files` can never match
//     for a request like /stock/AAPL — so it falls through to index.html, i.e. the
//     Globe tab's 426-tag prerender, and React hydrates it into a Stock screen.
//   - /settings and /auth fire despite having exact prerenders: those two have
//     client-only state at first paint (persisted zustand; runtime config + the
//     GoTrue provider probe). Separate, smaller cause.
//
// IMPORTANT: pageerror, not console — React reports #418 as an uncaught error, so a
// listener on 'console' alone reports zero and looks like a clean bill of health.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const DIST = new URL('./dist', import.meta.url).pathname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/runtime-config.js')){res.writeHead(200,{'content-type':'application/javascript'});res.end('window.__MUFFIN_CONFIG__='+JSON.stringify({supabaseUrl:'/supabase',supabaseAnonKey:process.env.SUPABASE_ANON_KEY||''})+';');return;}
  const rel=decodeURIComponent(req.url.split('?')[0]); let p=normalize(join(DIST,rel));
  if(!p.startsWith(DIST)){res.writeHead(403);res.end();return;}
  const exact = existsSync(p) && !statSync(p).isDirectory();
  if(!exact){const h=normalize(join(DIST,rel))+'.html'; p=existsSync(h)?h:join(DIST,'index.html');}
  res.setHeader('x-served', exact ? 'exact' : (existsSync(normalize(join(DIST,rel))+'.html') ? 'route-html' : 'spa-fallback'));
  res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});createReadStream(p).pipe(res);
});
await new Promise(r=>server.listen(0,r));
const base=`http://localhost:${server.address().port}`;
const ROUTES=['/','/markets','/portfolio','/agents','/calls','/settings','/auth','/verify',
  '/agents/research','/agents/council','/sector/information-technology','/country/united-states',
  '/region/north-america','/stock/AAPL','/group/north-america','/goal/new','/account/acc-isa','/calls/abc'];
const out={};
for(const scheme of ['light','dark']){
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox']});
  const pg=await b.newPage(); await pg.setViewport({width:1100,height:1200});
  await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:scheme}]);
  for(const r of ROUTES){
    const errs=[]; const h=(m)=>{if(m.type()==='error')errs.push(m.text());}; const hp=(e)=>errs.push('pageerror: '+e.message);
    pg.on('console',h); pg.on('pageerror',hp);
    let served='?';
    const resp = await pg.goto(base+r,{waitUntil:'domcontentloaded',timeout:60000});
    served = resp?.headers()['x-served'] ?? '?';
    await new Promise(x=>setTimeout(x,4000));
    pg.off('console',h); pg.off('pageerror',hp);
    const n418=errs.filter(e=>/#418|hydrat/i.test(e)).length;
    out[r]=out[r]||{served};
    out[r][scheme]={total:errs.length,n418,sample:errs.find(e=>/#418|hydrat/i.test(e))?.slice(0,150)};
  }
  await b.close();
}
console.log('route'.padEnd(34),'served'.padEnd(14),'light#418','dark#418','lightAll','darkAll');
for(const [r,v] of Object.entries(out)){
  console.log(r.padEnd(34), String(v.served).padEnd(14),
    String(v.light.n418).padEnd(9), String(v.dark.n418).padEnd(8),
    String(v.light.total).padEnd(8), String(v.dark.total));
}
const s=Object.values(out).map(v=>v.light.sample||v.dark.sample).find(Boolean);
console.log('\nsample #418 text:\n ', s||'(none)');
server.close();
