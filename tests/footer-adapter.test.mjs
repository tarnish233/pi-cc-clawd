import test from "node:test";
import assert from "node:assert/strict";
import {load,makeTheme} from "./helpers.mjs";
const {decorateFooter,removeFooterMarker,rightAlignGlyph,CLAWD_PLACEHOLDER,GLYPH_RIGHT_MARGIN,ClawdFooterFace}=await load("footer-adapter.ts");
const {ClawdPortrait,CLAWD_COLUMNS,combineGlyphs,MINI_COLUMNS,MINI_ROWS,STAGE_ROWS}=await load("sprite.ts");
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
	assert.equal(visibleWidth(lines[0].slice(0,lines[0].indexOf("\u{10eeee}"))),80-CLAWD_COLUMNS-GLYPH_RIGHT_MARGIN);
	assert.equal(visibleWidth(lines[0]),80);assert(lines[0].endsWith(" "));
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
	assert(line.includes("\u{10eeee}"));assert(!line.includes("\x1b_G"));assert.equal(visibleWidth(line),28);
	assert.equal(visibleWidth(line.slice(0,line.indexOf("\u{10eeee}"))),28-CLAWD_COLUMNS-GLYPH_RIGHT_MARGIN);
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

test("clicking the footer glyph pets Clawd; other footer cells keep their behaviour",async()=>{
	const h=setup();
	const base={render:()=>["model","cwd · "+CLAWD_PLACEHOLDER],invalidate(){}};
	const clicks=[];
	const footer=decorateFooter(base,h.portrait,undefined,count=>clicks.push(count));
	footer.render(80);
	const at=(x,y,count=1)=>({type:"click",button:"left",x,y,screenX:x,screenY:y,width:80,height:2,shift:false,alt:false,ctrl:false,clickCount:count});
	assert.deepEqual(footer.handleMouse(at(71,0)),{handled:true,render:false});
	assert.deepEqual(clicks,[1]);
	footer.handleMouse(at(70,1));assert.deepEqual(clicks,[1]); // left of the glyph
	footer.handleMouse(at(79,1));assert.deepEqual(clicks,[1]); // reserved right margin
	footer.handleMouse(at(72,1,4));assert.deepEqual(clicks,[1,4]);
	footer.handleMouse(at(72,2));assert.deepEqual(clicks,[1,4]); // footer's third line
	footer.handleMouse({...at(72,1),type:"move"});assert.deepEqual(clicks,[1,4]);
	assert.equal(footer.handleMouse(at(10,0)),undefined); // base has no mouse handler
	h.state.enabled=false;assert.equal(footer.handleMouse(at(72,1)),undefined);
	assert.deepEqual(clicks,[1,4]);
});

test("two parallel tools tile two half-width minis with their own image ids",async()=>{
	setCapabilities({images:"kitty",trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});
	const theme=await makeTheme();
	const state={enabled:true,motion:true,pose:"standing",activity:"tools",minis:[{name:"LookingAround",frame:0},{name:"Running",frame:4}]};
	const writes=[];const transport={write:data=>writes.push(data),fullRedraws:()=>0};
	const single=new ClawdPortrait(()=>state,()=>theme,()=>32,{placeholders:transport,stageRows:STAGE_ROWS});
	const makeMini=slot=>new ClawdPortrait(
		()=>({...state,clip:state.minis[slot]}),
		()=>theme,()=>32,
		{columns:MINI_COLUMNS,rows:MINI_ROWS,stageRows:MINI_ROWS,borderRow:-1,placeholders:transport},
	);
	const face=new ClawdFooterFace({getState:()=>state},single,makeMini);
	const glyph=face.renderGlyph();
	assert.equal(glyph.length,2);
	assert.equal(visibleWidth(glyph[0]),CLAWD_COLUMNS);
	assert.equal(visibleWidth(glyph[1]),CLAWD_COLUMNS);
	assert(glyph[0].includes("\u{10eeee}\u0305\u0305"),"minis use their own first row");
	assert(glyph[1].includes("\u{10eeee}\u030d\u0305"),"minis use their own second row");
	assert.equal(writes.length,2,"each mini uploads one image");
	assert(writes.every(write=>/,c=4,/.test(write)&&/,r=2,/.test(write)));
	const ids=writes.map(write=>/i=(\d+)/.exec(write)?.[1]);
	assert(ids[0]&&ids[1]&&ids[0]!==ids[1],"the two minis need distinct image ids");

	state.minis=undefined;
	const singleGlyph=face.renderGlyph();
	assert.equal(visibleWidth(singleGlyph[0]),CLAWD_COLUMNS);
	assert.match(writes.at(-1),/,c=8,/, "the full glyph returns at full size");
	assert.equal(single.stageActive(),false);

	state.minis=[{name:"LookingAround",frame:0},{name:"Running",frame:4}];
	face.renderGlyph();
	assert.match(writes.at(-1),/,c=4,/, "coming back re-uploads both minis");
	assert.match(writes.at(-2),/,c=4,/);
	face.dispose();
});

test("combining minis rejects a mismatched pair",async()=>{
	assert.deepEqual(combineGlyphs(["a"],["b","c"]),[]);
	assert.deepEqual(combineGlyphs(["a","b"],["c","d"]),["ac","bd"]);
});

test("clicking the stage overlay pets Clawd",async()=>{
	const h=setup();
	const {ClawdOverlay}=await load("footer-adapter.ts");
	const clicks=[];
	const overlay=new ClawdOverlay(()=>h.portrait,()=>makeTheme(),"stage",count=>clicks.push(count));
	const at=(x,y,count=1)=>({type:"click",button:"left",x,y,screenX:x,screenY:y,width:CLAWD_COLUMNS,height:2,shift:false,alt:false,ctrl:false,clickCount:count});
	assert.deepEqual(overlay.handleMouse({...at(1,1),type:"press"}),{handled:true,render:false});
	assert.deepEqual(clicks,[]);
	assert.deepEqual(overlay.handleMouse(at(1,1,2)),{handled:true,render:false});
	assert.deepEqual(clicks,[2]);
	assert.equal(overlay.handleMouse({...at(1,1),button:"right"}),undefined);
});
