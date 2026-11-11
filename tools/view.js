// usage: node view.js <glb> <out.png> [zoomYmin zoomYmax]
const { chromium } = require('playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const T=path.join(__dirname,'node_modules/three');
const glb=process.argv[2], y0=process.argv[4], y1=process.argv[5];
const html=`<!doctype html><body style="margin:0;background:#888"><canvas id=c></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.min.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type=module>
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const W=1680,H=560,r=new THREE.WebGLRenderer({canvas:c,preserveDrawingBuffer:true,antialias:true});r.setSize(W,H);r.setScissorTest(true);
const s=new THREE.Scene();s.background=new THREE.Color(0x8a8f98);s.add(new THREE.HemisphereLight(0xffffff,0x555555,2.2));const d=new THREE.DirectionalLight(0xffffff,2);d.position.set(1,2,3);s.add(d);
new GLTFLoader().load('/m.glb',g=>{s.add(g.scene);g.scene.traverse(o=>{if(o.material&&!o.material.map){o.material.metalness=0;o.material.roughness=0.75;}});g.scene.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(g.scene);
${y0?`const h=b.max.y-b.min.y,m=b.min.y;b.min.y=m+h*${y0};b.max.y=m+h*${y1};b.min.x*=0.3;b.max.x*=0.3;`:''}
const ctr=b.getCenter(new THREE.Vector3()),sz=b.getSize(new THREE.Vector3());const R=${y0?'sz.y*0.6':'Math.max(sz.x,sz.y,sz.z)*0.62'};
const cam=new THREE.OrthographicCamera(-R,R,R,-R,0.01,100);
[[0,0],[Math.PI/2,0],[Math.PI,0],[0.7,0.35]].forEach((a,i)=>{cam.position.set(ctr.x+5*Math.sin(a[0])*Math.cos(a[1]),ctr.y+5*Math.sin(a[1]),ctr.z+5*Math.cos(a[0])*Math.cos(a[1]));cam.lookAt(ctr);const w=W/4;cam.left=-R*w/H;cam.right=R*w/H;cam.updateProjectionMatrix();r.setViewport(i*w,0,w,H);r.setScissor(i*w,0,w,H);r.render(s,cam);});
window.__done=true;},undefined,e=>{console.error(e);window.__done='err'});
</script>`;
(async()=>{
 const srv=http.createServer((q,res)=>{if(q.url==='/')return res.end(html);if(q.url==='/m.glb')return fs.createReadStream(glb).pipe(res);const f=path.join(T,q.url.replace('/three/',''));if(q.url.startsWith('/three/')&&fs.existsSync(f)){res.setHeader('content-type','text/javascript');return fs.createReadStream(f).pipe(res);}res.statusCode=404;res.end();}).listen(0);
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:1680,height:560}});p.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text())});p.on('pageerror',e=>console.log('PAGEERR',e.message));
 await p.goto('http://localhost:'+srv.address().port+'/');await p.waitForFunction(()=>window.__done,null,{timeout:300000});
 await p.screenshot({path:process.argv[3]});await b.close();srv.close();
})();
