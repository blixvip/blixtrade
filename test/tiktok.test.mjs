import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTikTok,readTikTokQueue,fitVideoBox} from '../web/src/lib/tiktok.ts';
const url='https://www.tiktok.com/@scout2015/video/6718335390845095173';
test('TikTok links keep exact post IDs and strip tracking',()=>{
 assert.equal(parseTikTok(url+'?tracking=secret').url,url);
 assert.equal(parseTikTok(url).id,'6718335390845095173');
 assert.ok(parseTikTok(url.replace('/video/','/photo/')));
});
test('only official HTTPS post URLs enter the player',()=>{
 for(const u of ['javascript:alert(1)',url.replace('tiktok.com','tiktok.com.evil.test'),url.replace('https:','http:'),url.replace('www.','me:secret@www.'),'https://vm.tiktok.com/abc/', '<iframe src="'+url+'">','https://www.tiktok.com/@scout2015'])assert.equal(parseTikTok(u),null,u);
});
test('stored queue is revalidated, deduplicated and bounded',()=>{
 assert.deepEqual(readTikTokQueue(null),[]);
 assert.equal(readTikTokQueue([{url,id:'fake'},url,{url:'https://evil.test'}]).length,1);
 assert.equal(readTikTokQueue([{url,id:'fake'}])[0].id,'6718335390845095173');
 assert.equal(readTikTokQueue(Array.from({length:250},(_,i)=>url.replace('6718335390845095173',String(6718335390845095000n+BigInt(i))))).length,200);
});
test('floating video stays reachable after resizing or invalid persisted geometry',()=>{
 for(const [width,height] of [[1440,900],[390,844],[320,568],[700,350]]){
 const b=fitVideoBox({x:1e9,y:-200,w:Infinity,h:NaN},width,height);
 assert.ok(b.x>=8&&b.y>=8&&b.x+b.w<=width-8&&b.y+b.h<=height-64);
 }
});
