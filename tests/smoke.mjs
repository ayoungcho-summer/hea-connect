import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'hea-smoke-'));
let server;
function start(){server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3011',DB_PATH:join(dir,'test.sqlite'),NODE_ENV:'production',OPENAI_API_KEY:''},stdio:'pipe'});return new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('running at'))resolve();});server.stderr.on('data',d=>process.stderr.write(d));server.on('error',reject);});}
await start();
let browser;
try {
browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3011');await page.locator('.person-card').first().waitFor();assert.equal(await page.locator('.person-card').count(),12);
await page.screenshot({path:join(dir,'desktop.png'),fullPage:true});
await page.getByRole('textbox',{name:'Search participants'}).fill('Maya');assert.equal(await page.locator('.person-card').count(),1);
await page.getByRole('button',{name:'Clear search',exact:true}).click();
await page.getByLabel('Filter by attendance').selectOption('zoom');assert.equal(await page.locator('.person-card').count(),3);
await page.getByLabel('Filter by industry').selectOption('Climate / Sustainability');assert.equal(await page.locator('.person-card').count(),1);
await page.getByRole('button',{name:'Clear (2)',exact:true}).click();
await page.getByRole('button',{name:'List view',exact:true}).click();assert.ok(await page.locator('.people-grid').evaluate(e=>e.classList.contains('list-view')));
await page.getByRole('button',{name:'Grid view',exact:true}).click();
await page.getByRole('button',{name:'Maya Chen',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
await page.getByRole('tab',{name:'Ask & Offer board'}).click();assert.equal(await page.locator('.note-card').count(),24);await page.getByRole('button',{name:'ASK',exact:true}).click();assert.equal(await page.locator('.note-card').count(),12);await page.getByRole('button',{name:'OFFER',exact:true}).click();assert.equal(await page.locator('.note-card').count(),12);
await page.getByRole('tab',{name:'My matches'}).click();await page.getByLabel('Who are we matching?').selectOption('hea-1');await page.getByRole('button',{name:'Find my 3 matches'}).click();await page.locator('.match-card').first().waitFor();assert.equal(await page.locator('.match-card').count(),3);assert.ok((await page.locator('.results-heading').textContent()).includes('Local matching'));assert.equal(await page.locator('.match-card').filter({has:page.getByRole('heading',{name:'Maya Chen'})}).count(),0);
await page.getByRole('button',{name:'Join the directory',exact:true}).click();
await page.getByLabel('Full name',{exact:true}).fill('Taylor Test');await page.getByLabel('Your role',{exact:true}).selectOption('Builder / Engineer / Designer');await page.getByLabel('LinkedIn profile',{exact:true}).fill('https://www.linkedin.com/in/taylor-test');await page.getByRole('button',{name:'Software / SaaS',exact:true}).click();await page.getByRole('button',{name:'Finding Co-founders / Talent',exact:true}).click();await page.getByLabel('Your ask',{exact:true}).fill('Looking for a founder to build climate software.');await page.getByLabel('Your offer',{exact:true}).fill('React engineering and rapid prototyping.');await page.getByRole('dialog').getByRole('button',{name:'Join the directory',exact:true}).click();await page.getByRole('status').waitFor();assert.equal(await page.locator('.person-card').count(),13);
await page.reload();await page.locator('.person-card').first().waitFor();assert.equal(await page.locator('.person-card').count(),13);
await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(dir,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
const invalid=await page.request.post('http://localhost:3011/api/participants',{data:{name:'Invalid'}});assert.equal(invalid.status(),400);
assert.deepEqual(errors,[]);
await new Promise(resolve=>{server.on('exit',resolve);server.kill();});await start();
const persisted=await fetch('http://localhost:3011/api/participants').then(r=>r.json());assert.equal(persisted.length,13);assert.ok(persisted.some(p=>p.name==='Taylor Test'));
console.log(JSON.stringify({status:'PASS',checks:['directory','search','combined filters','list view','profile dialog','board toggles','three matches','registration','reload persistence','server restart persistence','invalid API input','390px overflow','no runtime errors'],artifacts:dir}));
} finally {await browser?.close();server.kill();}
