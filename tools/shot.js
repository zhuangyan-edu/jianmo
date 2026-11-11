// usage: node shot.js <out.png> [views-json]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '../face');
const THREE_FILE = path.join(__dirname, 'node_modules/three/build/three.module.min.js');
(async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><meta charset="utf-8"><body>' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); }).listen(0);
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const views = JSON.parse(process.argv[3] || '[[0,0.05],[0.6,0.05],[1.57,0.05],[-0.9,0.25]]');
  const W = 420, H = 520;
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text()); });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: fs.readFileSync(THREE_FILE), contentType: 'text/javascript' }));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.__view, null, { timeout: 60000 });
  console.log(await p.textContent('#stat'));
  const shots = [];
  for (const v of views) {
    shots.push(await p.evaluate(v => { window.__view(v[0], v[1], v[2], v[3] || {}); return document.getElementById('gl').toDataURL('image/png').split(',')[1]; }, v));
  }
  const q = await b.newPage({ viewport: { width: W * shots.length, height: H } });
  await q.setContent('<body style="margin:0;display:flex">' + shots.map(s => `<img style="background:linear-gradient(#2b3447,#6f6a72 62%,#d9a577)" width=420 height=520 src="data:image/png;base64,${s}">`).join(''));
  await q.screenshot({ path: process.argv[2] });
  await b.close(); srv.close();
})();
