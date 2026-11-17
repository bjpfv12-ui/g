import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:"new",args:["--no-sandbox","--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist"]});
const p = await b.newPage();
await p.goto("http://127.0.0.1:5178/",{waitUntil:"domcontentloaded",timeout:120000});
await new Promise(r=>setTimeout(r,5000));
const parked = await p.evaluate(()=>window.__carState.parked??[]);
const t = await p.evaluate((l)=>l[0],parked);
await p.evaluate((t)=>window.__playerState.body.setTranslation({x:t.x+1.2,y:1.2,z:t.z},true),t);
await new Promise(r=>setTimeout(r,800));
await p.keyboard.press("KeyF");
await new Promise(r=>setTimeout(r,600));
const out = await p.evaluate(()=>{
  const body = window.__carState.body;
  const eff = body.effectiveAngularInertia();
  const el = eff.elements;
  return {isArray:Array.isArray(el), len:el.length, values:Array.from(el), principal:body.principalInertia()};
});
console.log(JSON.stringify(out,null,2));
await b.close();
