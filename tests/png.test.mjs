import test from "node:test";
import assert from "node:assert/strict";
import {load} from "./helpers.mjs";
import {decodePng} from "./png-helpers.mjs";
const {encodePixelPng}=await load("png.ts");
const {drawClawd,PIXEL_COLORS}=await load("sprite.ts");

test("integer nearest-neighbor scaling reproduces every original source pixel",()=>{
	const source=drawClawd("standing");const png=decodePng(encodePixelPng(source,PIXEL_COLORS,72,48));
	assert.equal(png.width,72);assert.equal(png.height,48);
	for(let y=0;y<16;y++)for(let x=0;x<24;x++)for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
		assert.deepEqual(png.pixel(x*3+dx,y*3+dy),source[y][x]===null?[0,0,0,0]:PIXEL_COLORS[source[y][x]]);
	}
});

test("different cell aspect ratios add transparent headroom, never stretch the body",()=>{
	const source=drawClawd("standing");const png=decodePng(encodePixelPng(source,PIXEL_COLORS,72,54));
	for(let y=0;y<6;y++)for(let x=0;x<72;x++)assert.equal(png.pixel(x,y)[3],0);
	for(let y=0;y<16;y++)for(let x=0;x<24;x++)assert.deepEqual(png.pixel(x*3,6+y*3),source[y][x]===null?[0,0,0,0]:PIXEL_COLORS[source[y][x]]);
	assert.equal(png.pixel(12,53)[3],255);
});

test("fractional scaling stays sharp, with only original colors and transparency",()=>{
	const png=decodePng(encodePixelPng(drawClawd("standing"),PIXEL_COLORS,81,54));
	const allowed=new Set(["0,0,0,0",...Object.values(PIXEL_COLORS).map(color=>color.join(","))]);
	for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)assert(allowed.has(png.pixel(x,y).join(",")));
});

test("PNG bounds reject malformed and excessive allocations",()=>{
	const source=drawClawd("standing");
	for(const size of [0,-1,1.5,1025,Infinity,NaN])assert.throws(()=>encodePixelPng(source,PIXEL_COLORS,size,54),/Invalid PNG size/);
	assert.throws(()=>encodePixelPng([],PIXEL_COLORS,10,10),/Invalid pixel matrix/);
});
