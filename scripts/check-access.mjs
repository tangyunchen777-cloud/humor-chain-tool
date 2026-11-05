import assert from 'node:assert/strict';
const base=process.argv[2]||'http://localhost:3012';
for(const path of ['/','/api/studio']){const r=await fetch(new URL(path,base),{redirect:'manual'});assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),base).pathname,'/login');assert.match(r.headers.get('cache-control'),/no-store/);console.log('PASS anonymous protection '+path);}
const login=await fetch(new URL('/login',base));assert.equal(login.status,200);assert.match(await login.text(),/Continue with Google/);console.log('PASS publicly accessible Google login wall');
const r=await fetch(new URL('/auth/callback',base),{redirect:'manual'});assert.equal(new URL(r.headers.get('location'),base).pathname,'/login');console.log('PASS invalid callback');
