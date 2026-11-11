const fs=require('fs');
for(const f of process.argv.slice(2)){
  const fd=fs.openSync(f,'r');const h=Buffer.alloc(20);fs.readSync(fd,h,0,20,0);
  const len=h.readUInt32LE(12);const jb=Buffer.alloc(len);fs.readSync(fd,jb,0,len,20);
  const j=JSON.parse(jb.toString('utf8'));
  let v=0,t=0;const prims=[];
  for(const m of j.meshes||[])for(const p of m.primitives){const a=j.accessors[p.attributes.POSITION];v+=a.count;const n=p.indices!=null?j.accessors[p.indices].count/3:a.count/3;t+=n;prims.push({mesh:m.name,v:a.count,tris:n,min:a.min&&a.min.map(x=>+x.toFixed(2)),max:a.max&&a.max.map(x=>+x.toFixed(2)),attrs:Object.keys(p.attributes).join(','),mat:p.material})}
  console.log('\n==',f.split('/').pop(),(fs.statSync(f).size/1e6).toFixed(1)+'MB');
  console.log('generator',j.asset&&j.asset.generator,'| nodes',(j.nodes||[]).length,'meshes',(j.meshes||[]).length,'verts',v,'tris',t,'skins',(j.skins||[]).length,'joints',(j.skins||[]).map(s=>s.joints.length),'anims',(j.animations||[]).length,'ext',j.extensionsUsed);
  console.log('images',(j.images||[]).map(i=>i.mimeType+':'+(i.bufferView!=null?(j.bufferViews[i.bufferView].byteLength/1e6).toFixed(1)+'MB':i.uri)));
  console.log('materials',JSON.stringify(j.materials||[]).slice(0,600));
  console.log(prims.slice(0,8));
  if(j.skins&&j.skins[0])console.log('joints',j.skins[0].joints.map(i=>j.nodes[i].name).join(' '));
}
