import test from "node:test";
import assert from "node:assert/strict";
import {load,makeTheme} from "./helpers.mjs";
const {decorateFooter,removeFooterMarker,rightAlignGlyph,CLAWD_PLACEHOLDER}=await load("footer-adapter.ts");
const {ClawdPortrait,CLAWD_COLUMNS}=await load("sprite.ts");
const {setCapabilities,setCellDimensions,visibleWidth}=await load("@earendil-works/pi-tui");

function setup(images="kitty") {
	setCapabilities({images,trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});
	const state={enabled:true,motion:true,pose:"standing"};
	const transport={writes:[],redraws:0};
	const portrait=new ClawdPortrait(()=>state,()=>makeTheme(),()=>32,{placeholders:{
		write:data=>transport.writes.push(data),fullRedraws:()=>transport.redraws,
	}});
	return {state,portrait,transport};
}

test("one two-row image spans the right side of both existing footer lines",async()=>{
	const h=setup();let disposed=0;
	const base={
		render:()=>["first", "  cwd · main · "+CLAWD_PLACEHOLDER,"third"],
		invalidate(){this.invalidated=(this.invalidated??0)+1;},dispose(){disposed++;},
	};
	const footer=decorateFooter(base,h.portrait);const lines=footer.render(80);
	assert(lines[0].startsWith("first"));assert(lines[0].includes("\u{10eeee}"));assert.equal(lines[2],"third");assert.equal(lines.length,3);
	assert(lines.every(line=>!line.includes("\x1b_G")));assert(!lines[1].includes(CLAWD_PLACEHOLDER));assert(lines[1].includes("\u{10eeee}"));
	assert.match(h.transport.writes[0],/a=T,U=1/);assert.match(h.transport.writes[0],/[,]c=8[,]/);assert.match(h.transport.writes[0],/[,]r=2[,]/);
	assert.equal(visibleWidth(lines[0].slice(0,lines[0].indexOf("\u{10eeee}"))),80-CLAWD_COLUMNS);
	assert(lines[1].startsWith("  cwd · main"));assert(!lines[1].includes("main ·"));
	assert.equal(visibleWidth(lines[1]),80);
	footer.invalidate();assert.equal(base.invalidated,1);footer.dispose();assert.equal(disposed,1);
});

test("incompatible marker positions are sanitized without rewriting the remaining text",async()=>{
	const h=setup();const base={render:()=>["one","two","status "+CLAWD_PLACEHOLDER],invalidate(){}};
	const lines=decorateFooter(base,h.portrait).render(80);assert.deepEqual(lines,["one","two","status "]);
	assert(lines.every(line=>!line.includes(CLAWD_PLACEHOLDER)));
});

test("marker cleanup strips only adjacent separators and never merges footer words",()=>{
	assert.equal(removeFooterMarker("cwd · main"+CLAWD_PLACEHOLDER),"cwd · main");
	assert.equal(removeFooterMarker("cwd · main "+CLAWD_PLACEHOLDER),"cwd · main ");
	assert.equal(removeFooterMarker("cwd · main · "+CLAWD_PLACEHOLDER),"cwd · main");
	assert.equal(removeFooterMarker(CLAWD_PLACEHOLDER+" · other"),"other");
	assert.equal(removeFooterMarker("  "+CLAWD_PLACEHOLDER+" · other"),"  other");
});

test("narrow footer truncates existing content rather than overflowing or distorting the glyph",async()=>{
	const h=setup();const line=rightAlignGlyph("  very long project · branch · ",h.portrait.renderGlyph()[0],28);
	assert(line.includes("\u{10eeee}"));assert(!line.includes("\x1b_G"));assert.equal(visibleWidth(line.slice(0,line.indexOf("\u{10eeee}"))),28-CLAWD_COLUMNS);
	assert(visibleWidth(line.slice(0,line.indexOf("\u{10eeee}")))<=28-CLAWD_COLUMNS);
	assert.equal(removeFooterMarker("plain"),"plain");
	const tooSmall=rightAlignGlyph("tiny",h.portrait.renderGlyph()[0],CLAWD_COLUMNS);
	assert.equal(tooSmall,"tiny");assert(!tooSmall.includes("\u{10eeee}"));assert(visibleWidth(tooSmall)<=CLAWD_COLUMNS);
});

test("ordinary footer updates neither delete nor re-upload the image; full redraws restore it",async()=>{
	const h=setup();let text="first";
	const base={render:()=>[text,"cwd · "+CLAWD_PLACEHOLDER],invalidate(){}};
	const footer=decorateFooter(base,h.portrait);
	footer.render(80);assert.equal(h.transport.writes.length,1);
	text="changed model and context";footer.render(80);assert.equal(h.transport.writes.length,1);
	assert(!footer.render(80).some(line=>line.includes("\x1b_G")));
	h.transport.redraws++;await Promise.resolve();
	assert.equal(h.transport.writes.length,2);assert.match(h.transport.writes[1],/a=T,U=1/);
	h.state.pose="blink";footer.render(80);assert.equal(h.transport.writes.length,3);
});

test("text-only terminals remove the marker and never reserve an extra line",async()=>{
	const h=setup(null);const base={render:()=>["one","cwd · "+CLAWD_PLACEHOLDER],invalidate(){}};
	const lines=decorateFooter(base,h.portrait).render(80);
	assert.equal(lines.length,2);assert(!lines[1].includes(CLAWD_PLACEHOLDER));assert.equal(lines[1],"cwd");
	assert.deepEqual(h.portrait.renderGlyph(),[]);
});
