import test from "node:test";
import assert from "node:assert/strict";
import {FakeClock,extensionHarness,load} from "./helpers.mjs";
const {createClawdExtension}=await load("index.ts");
const {CLAWD_ROWS}=await load("sprite.ts");

async function setup(){
	const h=await extensionHarness();const clock=new FakeClock();
	createClawdExtension({schedule:clock.schedule,random:()=>0})(h.pi);
	return {h,clock};
}

test("capture a later custom footer factory, then mount only after startup handlers",async()=>{
	const {h,clock}=await setup();
	h.pi.on("session_start",(_event,ctx)=>ctx.ui.setFooter((_tui,_theme,data)=>({
		render:()=>["one","two "+(data.getExtensionStatuses().get("pi-cc-clawd")??"")],invalidate(){},
	})));
	await h.emit("session_start");assert.equal(h.footerSets,1);assert.equal(h.widget,undefined);assert.equal(clock.jobs.size,1);
	assert(h.footer.render(80)[0].includes("\u{10eeee}"));assert.equal(CLAWD_ROWS,2);assert.equal(h.editorSets,0);
	await h.emit("session_shutdown");
});

test("resource discovery is idempotent and does not replace footer or editor",async()=>{
	const {h,clock}=await setup();await h.emit("session_start");
	const widget=h.widget;h.editor.setText("draft");
	await h.emit("resources_discover");await h.emit("resources_discover");
	assert.equal(h.widget,widget);assert.equal(h.footerSets,0);assert.equal(h.editorSets,0);assert.equal(h.editor.getText(),"draft");assert.equal(clock.jobs.size,1);
	h.editor.handleInput("\x1f");assert.equal(h.editor.getText(),"");await h.emit("session_shutdown");
});

test("an incompatible custom footer never leaks markers and falls back below the editor",async()=>{
	const {h,clock}=await setup();
	h.pi.on("session_start",(_event,ctx)=>ctx.ui.setFooter((_tui,_theme,data)=>({
		render:()=>["model","cwd","status "+(data.getExtensionStatuses().get("pi-cc-clawd")??"")],invalidate(){},
	})));
	await h.emit("session_start");const lines=h.footer.render(80);
	assert(lines.every(line=>!line.includes("\ue000")));
	await Promise.resolve();assert.equal(h.widget.placement,"belowEditor");assert.equal(h.statuses.size,0);
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);
});

test("shutdown before resource discovery restores footer and never starts a timer",async()=>{
	const {h,clock}=await setup();const setFooter=h.ctx.ui.setFooter;await h.emitRaw("session_start");
	assert.notEqual(h.ctx.ui.setFooter,setFooter);assert.equal(clock.jobs.size,0);
	await h.emit("session_shutdown");await h.emit("resources_discover");
	assert.equal(h.ctx.ui.setFooter,setFooter);assert.equal(clock.jobs.size,0);assert.equal(h.footerSets,0);assert.equal(h.widget,undefined);
});
