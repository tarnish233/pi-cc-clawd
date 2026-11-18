import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createHash} from "node:crypto";
import {load,makeTheme,findPiInstall} from "./helpers.mjs";
const {drawClawd,ClawdPortrait,SOURCE_COLUMNS,SOURCE_ROWS,CLAWD_COLUMNS,CLAWD_ROWS,TEXT_COLUMNS,TEXT_ROWS,MIN_COLUMNS,MIN_ROWS}=await load("sprite.ts");
const {FOOTER_SPRITE_NAMES}=await load("official-sprites.ts");
const RIGHT_INSET=0;
const {visibleWidth,stripTerminalSequences,setCapabilities,setCellDimensions}=await load("@earendil-works/pi-tui");
const host=findPiInstall();
const {getKittyImagePlacement,getKittyImageMetadata}=await load(path.join(host.tui,"dist/terminal-image.js"));
const poses=["standing","blink","look-left","look-right"];
const caps=images=>{setCapabilities({images,trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});};
const state=pose=>({enabled:true,motion:true,pose});
const portrait=(theme,s=state("standing"),rows=32,options={})=>new ClawdPortrait(()=>s,()=>theme,()=>rows,options);

test("canonical standing silhouette matches the official reference, not the compact redraw",()=>{
	assert.equal(SOURCE_COLUMNS,24);assert.equal(SOURCE_ROWS,16);
	const pixels=drawClawd("standing");
	const mask=pixels.flat().map(p=>p==="body"?"1":p==="eye"?"0":".").join("");
	assert.equal(createHash("sha256").update(mask).digest("hex"),"51cfa71127ba33cd387b2feccbac3e0e74391ccd481de63a0405e1c3324961f7");
	assert.equal(pixels[0].filter(p=>p!==null).length,16);
	assert.equal(pixels[4].filter(p=>p!==null).length,24);
	assert.deepEqual(pixels[15].flatMap((p,x)=>p===null?[]:[x]),[4,5,8,9,14,15,18,19]);
});

test("blinks and glances never modify the original body, arms or feet",()=>{
	const body=pixels=>pixels.map(row=>row.map(p=>p==="eye"?"body":p));
	const expected=body(drawClawd("standing"));
	for(const pose of poses){const pixels=drawClawd(pose);assert.equal(pixels.length,16);assert(pixels.every(row=>row.length===24));
		assert.equal(pixels.flat().filter(p=>p==="eye").length,pose==="blink"?0:8);assert.deepEqual(body(pixels),expected);}
});

test("Kitty rendering is a compact two-row image at the right inset",async()=>{
	caps("kitty");const p=portrait(await makeTheme());
	for(let width=MIN_COLUMNS;width<=160;width++){
		const lines=p.render(width);assert.equal(lines.length,CLAWD_ROWS);assert.equal(visibleWidth(lines[0]),width);
		assert(lines.slice(1).every(line=>visibleWidth(line)===0));
		assert.equal(visibleWidth(lines[0].slice(0,lines[0].indexOf("\x1b_G"))),width-CLAWD_COLUMNS-RIGHT_INSET);
		const meta=getKittyImageMetadata(lines[0]);assert.equal(meta.columns,CLAWD_COLUMNS);assert.equal(meta.rows,CLAWD_ROWS);assert.equal(meta.widthPx,CLAWD_COLUMNS*9);assert.equal(meta.heightPx,CLAWD_ROWS*18);
	}
});

test("cached poses share one image ID but refresh fullscreen data when switching back",async()=>{
	caps("kitty");const s=state("standing");const p=portrait(await makeTheme(),s);
	const a=p.render(80);const ga=getKittyImagePlacement(a[0]);
	s.pose="blink";p.invalidate();const b=p.render(80);const gb=getKittyImagePlacement(b[0]);
	s.pose="standing";p.invalidate();const c=p.render(80);const gc=getKittyImagePlacement(c[0]);
	assert.equal(ga.imageId,gb.imageId);assert.equal(gb.imageId,gc.imageId);
	assert(gb.transmissionGeneration>ga.transmissionGeneration);assert(gc.transmissionGeneration>gb.transmissionGeneration);
	assert.deepEqual(a,c);
	p.invalidate();assert.equal(getKittyImagePlacement(p.render(80)[0]).transmissionGeneration,gc.transmissionGeneration);
});

test("cell-size changes refresh the PNG while keeping the same image ID",async()=>{
	caps("kitty");const p=portrait(await makeTheme());const before=getKittyImagePlacement(p.render(80)[0]);
	setCellDimensions({widthPx:10,heightPx:20});const lines=p.render(80);const after=getKittyImagePlacement(lines[0]);
	assert.equal(before.imageId,after.imageId);assert(after.transmissionGeneration>before.transmissionGeneration);
	const meta=getKittyImageMetadata(lines[0]);assert.equal(meta.widthPx,CLAWD_COLUMNS*10);assert.equal(meta.heightPx,CLAWD_ROWS*20);
});

test("hide/reappear refreshes image data without leaving a rendered placement",async()=>{
	caps("kitty");const s=state("standing");const p=portrait(await makeTheme(),s);const first=getKittyImagePlacement(p.render(80)[0]);
	s.enabled=false;assert.deepEqual(p.render(80),[]);s.enabled=true;const next=getKittyImagePlacement(p.render(80)[0]);
	assert.equal(first.imageId,next.imageId);assert(next.transmissionGeneration>first.transmissionGeneration);
});

test("all footer-enabled official frames render through both PNG and generic RGBA text paths",async()=>{
	caps("kitty");const s={...state("standing"),activity:"working"};const writes=[];
	const options={placeholders:{write:data=>writes.push(data),fullRedraws:()=>0}};
	const p=portrait(await makeTheme(),s,32,options);
	for(const name of FOOTER_SPRITE_NAMES){
		s.clip={name,frame:0};const glyph=p.renderGlyph();assert.equal(glyph.length,2);assert(glyph.every(line=>visibleWidth(line)===CLAWD_COLUMNS));
		const direct=p.render(80);assert.equal(direct.length,CLAWD_ROWS);assert.equal(visibleWidth(direct[0]),80);
		assert(direct.slice(1).every(line=>visibleWidth(line)===0));
	}
	assert.equal(writes.length,FOOTER_SPRITE_NAMES.length);
	caps(null);for(const name of FOOTER_SPRITE_NAMES){
		s.clip={name,frame:0};const text=p.render(80);
		assert.equal(text.length,TEXT_ROWS,`${name} must not change the text widget height`);
		assert(text.every(line=>visibleWidth(line)===80));assert(text.join("").includes("38;2;"));
	}
});

test("text fallback keeps the original geometry at four rows, never redraws for three",async()=>{
	for(const protocol of [null,"iterm2","kitty"]){
		caps(protocol);const theme=await makeTheme();const options=protocol==="kitty"?{mode:"text"}:{};
		for(const pose of poses){const p=portrait(theme,state(pose),32,options);const lines=p.render(80);
			assert.equal(lines.length,TEXT_ROWS);assert.equal(TEXT_COLUMNS,12);assert(lines.every(line=>visibleWidth(line)===80));
			assert(lines.every(line=>!line.includes("\x1b_G")&&!line.includes("\x1b]")));
			assert.equal(stripTerminalSequences(lines.at(-1)).split("█").length-1,4);
		}
	}
});

test("narrow and short terminals hide instead of clipping either backend",async()=>{
	const theme=await makeTheme();
	for(const protocol of [null,"kitty"]){caps(protocol);const p=portrait(theme);
		for(const width of [0,1,MIN_COLUMNS-1,NaN,Infinity])assert.deepEqual(p.render(width),[]);
		assert.deepEqual(portrait(theme,undefined,MIN_ROWS-1).render(100),[]);
	}
});

test("text colors respect theme mode and images are not emitted for invalid cells",async()=>{
	caps("kitty");setCellDimensions({widthPx:Infinity,heightPx:18});const dark=await makeTheme("truecolor");const light=await makeTheme("256color","light");
	let theme=dark;const p=new ClawdPortrait(()=>state("standing"),()=>theme,()=>32);
	const first=p.render(80);assert.equal(first.length,TEXT_ROWS);assert(first.join("").includes("38;2;"));
	theme=light;const second=p.render(80);assert(second.join("").includes("38;5;"));assert(!second.join("").includes("38;2;"));
	p.invalidate();assert.deepEqual(p.render(80),second);
});
