const fs=require('fs'),os=require('os'),path=require('path');
const {pathToFileURL}=require('url');
let puppeteer;
try { puppeteer=require(process.env.PUPPETEER_MODULE || 'puppeteer-core'); }
catch (error) { throw new Error('Install optional dependencies with npm install, or set PUPPETEER_MODULE.'); }
const browserCandidates=[
  process.env.BROWSER_EXECUTABLE,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);
const executable=browserCandidates.find(file=>fs.existsSync(file));
if (!executable) throw new Error('Set BROWSER_EXECUTABLE to the local Chrome/Chromium executable.');
const root=path.resolve(__dirname,'..');
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'magical-athlete-browser-'));
  let browser;const errors=[],checks={};
  try{
    browser=await puppeteer.launch({executablePath:executable,headless:true,userDataDir:profile,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('requestfailed',r=>errors.push(`${r.failure()?.errorText}: ${r.url()}`));
    await page.setViewport({width:1440,height:1000});
    await page.goto(pathToFileURL(path.join(root,'index.html')).href,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#gallery .asset',{timeout:10000});
    await page.waitForFunction(()=>document.querySelector('.original img').complete&&document.querySelector('.original img').naturalWidth===600,{timeout:10000});
    checks.roles=await page.$$eval('#gallery .asset',items=>items.length);
    checks.prefabs=await page.$$eval('#page-select option',items=>items.length);
    const screenshot=path.join(os.tmpdir(),'magical-athlete-report-desktop.png');await page.screenshot({path:screenshot});fs.copyFileSync(screenshot,path.join(root,'previews/report-desktop.png'));
    await page.type('#search','火箭专家');checks.role_search=await page.$$eval('#gallery img',items=>items.map(i=>i.alt));
    await page.click('#gallery button');await page.waitForFunction(()=>document.querySelector('#zoom-image').complete&&document.querySelector('#zoom-image').naturalWidth>0,{timeout:10000});
    checks.zoom=await page.$eval('#zoom',e=>e.open);await page.click('#close');
    await page.$eval('#search',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.click('[data-group="全部"]');checks.assets=await page.$$eval('#gallery .asset',items=>items.length);
    await page.click('[data-group="骰子"]');checks.dice=await page.$$eval('#gallery .asset',items=>items.length);
    const index=await page.$$eval('#page-select option',items=>items.find(e=>e.textContent.includes('DialogDiceConfirm')).value);
    await page.select('#page-select',index);checks.dice_dialog_table=await page.$eval('#node-table',e=>e.textContent.includes('确认移动')&&e.textContent.includes('520 × 350'));
    await page.setViewport({width:390,height:844});checks.mobile_overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    checks.errors=errors;checks.passed=checks.roles===36&&checks.prefabs===16&&checks.assets===197&&checks.dice===37&&checks.zoom&&checks.dice_dialog_table&&!checks.mobile_overflow&&errors.length===0;
    fs.writeFileSync(path.join(root,'evidence/browser-check.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));if(!checks.passed)process.exitCode=1;
  }finally{if(browser)await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
