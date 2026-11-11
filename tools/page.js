// usage: node page.js <page path relative to repo root, may include ?query> <out.png> [views-json] [setup-js]
// views: [[azimuth, elevation, distance, [tx,ty,tz]], ...] passed to window.__view; setup-js is evaluated once after load.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), THREE_DIR = path.join(__dirname, 'node_modules/three');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(r);
  }).listen(0);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const views = JSON.parse(process.argv[4] || '[[0,0.05],[0.7,0.1],[1.57,0.05],[3.14,0.05]]');
  const W = +(process.env.W || 480), H = +(process.env.H || 640);
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('console', m => { if (m.type() === 'error' || m.text().startsWith('INFO')) console.log(m.text()); });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  // the page loads three from the CDN; serve the local copy instead so this works offline
  await p.route('https://cdn.jsdelivr.net/npm/three@*/**', r => {
    const f = path.join(THREE_DIR, r.request().url().replace(/^.*three@[^/]+\//, ''));
    r.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
  });
  await p.goto(`http://localhost:${srv.address().port}/${process.argv[2]}`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  if (process.argv[5]) { const r = await p.evaluate(process.argv[5][0] === '@' ? fs.readFileSync(process.argv[5].slice(1), 'utf8') : process.argv[5]); if (r !== undefined) console.log(r); }
  const shots = [];
  for (const v of views) shots.push(await p.evaluate(v => { window.__view(...v); return document.querySelector('canvas').toDataURL('image/png').split(',')[1]; }, v));
  const q = await b.newPage({ viewport: { width: W * shots.length, height: H } });
  await q.setContent('<body style="margin:0;display:flex;background:#333">' + shots.map(s => `<img width=${W} height=${H} src="data:image/png;base64,${s}">`).join(''));
  await q.screenshot({ path: process.argv[3] });
  await b.close(); srv.close();
})();
