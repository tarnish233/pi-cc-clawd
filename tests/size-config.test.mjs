import test from "node:test";
import assert from "node:assert/strict";
import {load,makeTheme} from "./helpers.mjs";
const {ClawdPortrait,CLAWD_COLUMNS,CLAWD_ROWS,FALLBACK_COLUMNS,FALLBACK_ROWS}=await load("sprite.ts");
const {setCapabilities,setCellDimensions,visibleWidth}=await load("@earendil-works/pi-tui");
const setKitty=()=>{setCapabilities({images:"kitty",trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});};

test("footer size is fixed at eight columns by two rows, not environment-dependent",()=>{
	assert.equal(CLAWD_COLUMNS,8);assert.equal(CLAWD_ROWS,2);
	process.env.PI_CLAWD_COLUMNS="4";process.env.PI_CLAWD_LEGACY_ROWS="1";
	try {
		setKitty();const portrait=new ClawdPortrait(()=>({enabled:true,motion:true,pose:"standing"}),()=>makeTheme(),()=>32);
		const lines=portrait.render(80);assert.equal(lines.length,2);
		assert(lines[0].includes("c=8,r=2"));assert.equal(lines[0].indexOf("\x1b_G"),80-8);
	} finally {delete process.env.PI_CLAWD_COLUMNS;delete process.env.PI_CLAWD_LEGACY_ROWS;}
});

test("explicit fallback and development preview dimensions preserve the canonical source",async()=>{
	setKitty();
	assert.equal(FALLBACK_COLUMNS,4);assert.equal(FALLBACK_ROWS,1);
	const fallback=new ClawdPortrait(()=>({enabled:true,motion:true,pose:"standing"}),()=>makeTheme(),()=>32,{columns:FALLBACK_COLUMNS,rows:FALLBACK_ROWS});
	assert.equal(fallback.render(80).length,1);assert(fallback.render(80)[0].includes("c=4,r=1"));
	const preview=new ClawdPortrait(()=>({enabled:true,motion:true,pose:"standing"}),()=>makeTheme(),()=>32,{columns:6,rows:2});
	const lines=preview.render(80);assert.equal(lines.length,2);
	assert(lines[0].includes("c=6,r=2"));assert.equal(lines[0].indexOf("\x1b_G"),80-6);
	assert.equal(visibleWidth(lines[0]),80);assert(lines.slice(1).every(line=>visibleWidth(line)===0));
});

test("a footer glyph reserves two selectable placeholder rows and uploads out of band",async()=>{
	setKitty();const writes=[];
	const portrait=new ClawdPortrait(()=>({enabled:true,motion:true,pose:"standing"}),()=>makeTheme(),()=>32,{placeholders:{write:data=>writes.push(data),fullRedraws:()=>0}});
	const glyph=portrait.renderGlyph();assert.equal(glyph.length,2);
	assert(glyph.every(line=>line.includes("\u{10eeee}")&&!line.includes("\x1b_G")));
	assert.match(writes[0],/a=T,U=1/);assert.match(writes[0],/[,]c=8[,]/);assert.match(writes[0],/[,]r=2[,]/);
	assert.equal(visibleWidth(glyph[0]),CLAWD_COLUMNS);assert.equal(visibleWidth(glyph[1]),CLAWD_COLUMNS);
});
