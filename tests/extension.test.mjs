import test from "node:test";
import assert from "node:assert/strict";
import { FakeClock,extensionHarness,load } from "./helpers.mjs";
const {createClawdExtension}=await load("index.ts");
const {PREFERENCES_ENTRY}=await load("preferences.ts");
const {CLAWD_PLACEHOLDER}=await load("footer-adapter.ts");
const {FALLBACK_ROWS,TEXT_ROWS,CLAWD_COLUMNS,CLAWD_ROWS,OVERLAY_ROWS}=await load("sprite.ts");
const {visibleWidth}=await load("@earendil-works/pi-tui");

async function setup(mode="tui",withFooter=false) {
	const h=await extensionHarness(mode);const clock=new FakeClock();
	createClawdExtension({schedule:clock.schedule,random:()=>0})(h.pi);
	if(withFooter)h.pi.on("session_start",(_event,ctx)=>ctx.ui.setFooter((tui,theme,data)=>({
		render(width){return ["model",theme.fg("dim","cwd · main · "+(data.getExtensionStatuses().get("pi-cc-clawd")??""))];},
		invalidate(){},
	})));
	return {h,clock};
}

test("factory only registers hooks; startup captures later footer without changing the editor",async()=>{
	const {h,clock}=await setup("tui",true);assert.equal(clock.jobs.size,0);assert.equal(h.footerSets,0);
	await h.emit("session_start");assert.equal(clock.jobs.size,1);assert.equal(h.footerSets,1);assert.equal(h.editorSets,0);
	assert.equal(h.editor.render(80).length,3);assert.equal(h.widget,undefined);
	const lines=h.footer.render(80);assert.equal(lines.length,2);assert(lines[0].startsWith("model"));
	assert(lines[0].includes("\u{10eeee}"));assert(lines.every(line=>!line.includes("\x1b_G")));assert(!lines[1].includes(CLAWD_PLACEHOLDER));const {visibleWidth}=await load("@earendil-works/pi-tui");
	assert.equal(visibleWidth(lines[0].slice(0,lines[0].indexOf("\u{10eeee}"))),71);
	assert.match(h.tui.terminal.output,/a=T,U=1/);
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);assert.equal(h.statuses.size,0);
});

for(const mode of ["rpc","print","json"]) {
	test(mode+" mode has no rendering, timers, footer or editor changes",async()=>{
		const {h,clock}=await setup(mode);await h.emit("session_start");await h.command("on");await h.emit("session_shutdown");
		assert.equal(h.footerSets,0);assert.equal(clock.jobs.size,0);assert.equal(h.entries.length,0);assert.equal(h.tui.renders,0);assert.equal(h.widget,undefined);
	});
}

test("without a captured footer the glyph sits inside the editor lines and reserves no row",async()=>{
	const {h,clock}=await setup();await h.emit("session_start");
	assert.equal(h.editorSets,0);assert.equal(h.editor.render(80).length,3);assert.equal(h.footerSets,0);
	assert.equal(h.widget.placement,"belowEditor");
	assert.equal(h.widget.component.render(80).length,0); // zero rows: the overlay owns the pixels
	assert.equal(h.statuses.size,0);
	await Promise.resolve();
	assert.equal(h.tui.overlays.length,1);
	const overlay=h.tui.overlays[0];
	assert.equal(overlay.options.anchor,"bottom-center");
	assert.equal(overlay.options.width,8);
	assert.equal(overlay.options.maxHeight,2);
	assert.equal(overlay.options.nonCapturing,true);
	assert.equal(overlay.options.margin,undefined);
	const inline=overlay.component.render(8);
	assert.equal(inline.length,2);
	assert(inline.every(line=>visibleWidth(line)===8));
	assert(inline.every(line=>line.includes("\u{10eeee}")));
	assert(!inline[1].includes("─")); // the footer middle has no border to preserve
	h.editor.setText("x".repeat(80));assert.equal(overlay.component.render(8).length,2);
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);assert.equal(h.widget,undefined);assert.equal(overlay.removed,true);
});

test("a terminal without Kitty keeps the chunky four-row text widget",async()=>{
	const {h,clock}=await setup();
	const {setCapabilities}=await load("@earendil-works/pi-tui");
	setCapabilities({images:null,trueColor:true,hyperlinks:true});
	await h.emit("session_start");
	assert.equal(h.widget.placement,"belowEditor");
	assert.equal(h.widget.component.render(80).length,TEXT_ROWS);
	assert.equal(h.tui.overlays.length,0);
	await h.emit("session_shutdown");
	assert.equal(clock.jobs.size,0);
});

test("on/off/pause/resume preserve the editor, footer factory and input draft",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");const footer=h.footer;
	h.editor.setText("draft");
	for(const command of ["off","on","pause","resume",""]) {
		await h.command(command);assert.equal(h.footer,footer);assert.equal(h.footerSets,1);assert.equal(h.editorSets,0);
		assert.equal(h.editor.getText(),"draft");
	}
	await h.command("off");assert.equal(h.statuses.size,0);assert(!h.footer.render(80)[1].includes("\u{10eeee}"));
	h.tui.terminal.output="";await h.command("on");assert(h.footer.render(80)[0].includes("\u{10eeee}"));
	assert(h.tui.terminal.output.includes("a=T,U=1")); // re-upload even if a redraw discarded data while hidden
	h.editor.handleInput("\x1f");assert.equal(h.editor.getText(),"");
	assert(h.entries.every(entry=>entry.type==="custom"&&entry.customType===PREFERENCES_ENTRY));
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);
});

test("clearing the custom footer removes the marker and restores the native fallback",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");
	assert(h.footer.render(80)[0].includes("\u{10eeee}"));assert.equal(h.widget,undefined);
	h.ctx.ui.setFooter(undefined);
	assert.equal(h.footer,undefined);assert.equal(h.statuses.size,0);
	assert.equal(h.widget.placement,"belowEditor");assert.equal(h.widget.component.render(80).length,0);
	await Promise.resolve();assert.equal(h.tui.overlays.length,1);
	assert.equal(h.editorSets,0);assert.equal(clock.jobs.size,1);
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);
});

test("paused mascot stays in footer with no autonomous redraws; manual blink is transient",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");await h.command("pause");
	assert.equal(h.footer.render(80).length,2);assert.equal(clock.jobs.size,0);
	const renders=h.tui.renders;clock.advance(20000);assert.equal(h.tui.renders,renders);
	await h.command("blink");assert.equal(clock.jobs.size,1);clock.advance(160);assert.equal(clock.jobs.size,0);
	await h.emit("session_shutdown");
});

test("reload restores preferences and doesn't duplicate timers or wrappers",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");await h.command("pause");
	await h.emit("session_shutdown");h.resetEditor();await h.emit("session_start",{reason:"reload"});
	assert.equal(h.footer.render(80).length,2);assert.equal(clock.jobs.size,0);assert.equal(h.editorSets,0);
	await h.command("off");await h.emit("session_shutdown");h.resetEditor();await h.emit("session_start");
	assert.equal(h.statuses.size,0);assert.equal(clock.jobs.size,0);assert(!h.footer.render(80)[1].includes(CLAWD_PLACEHOLDER));
	await h.emit("session_shutdown");
});

test("tree navigation restores the selected branch's preferences without rebuilding the editor",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");await h.command("off");assert.equal(h.statuses.size,0);
	h.entries.length=0;await h.emit("session_tree");assert.equal(h.footer.render(80).length,2);assert.equal(clock.jobs.size,1);assert.equal(h.editorSets,0);
	await h.emit("session_shutdown");
});

test("agent events and play commands render official frames without touching the editor",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");
	const standing=h.tui.terminal.output;h.tui.terminal.output="";
	await h.emitRaw("agent_start");h.footer.render(80);const desktop=h.tui.terminal.output;
	assert(desktop.includes("a=T,U=1"));assert.notEqual(desktop,standing);
	h.tui.terminal.output="";await h.emitRaw("tool_execution_start",{toolCallId:"tool-1"});h.footer.render(80);
	assert.notEqual(h.tui.terminal.output,desktop);
	await h.emitRaw("tool_execution_end",{toolCallId:"tool-1",isError:false});
	await h.emitRaw("agent_settled",{aborted:false});clock.advance(3400);
	await h.command("play Waving");assert.equal(h.notices.length,0);assert.equal(clock.jobs.size,1);
	assert.equal(h.tui.overlays.length,1);
	const overlay=h.tui.overlays[0];
	assert.equal(overlay.options.anchor,"bottom-right");
	assert.equal(overlay.options.width,CLAWD_COLUMNS);
	assert.equal(overlay.options.maxHeight,OVERLAY_ROWS);
	assert.equal(overlay.options.nonCapturing,true);
	assert.deepEqual(overlay.options.margin,{right:1,bottom:CLAWD_ROWS});
	clock.advance(900);
	const stage=overlay.component.render(CLAWD_COLUMNS);
	assert.equal(stage.length,1);assert(stage[0].includes("\u{10eeee}"));assert(stage[0].includes("─"));
	await h.command("play Hula");assert.equal(h.notices.length,0);assert.equal(clock.jobs.size,1);
	assert.equal(overlay.removed,true);
	assert.equal(h.editorSets,0);assert(h.entries.every(entry=>entry.customType!=="clawd-animation"));
	await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);
});

test("tree preference restores do not reset live agent activity or tool tracking",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");
	await h.emitRaw("agent_start");await h.emitRaw("tool_execution_start",{toolCallId:"live"});h.footer.render(80);
	h.tui.terminal.output="";await h.emitRaw("session_tree");h.footer.render(80);
	assert.equal(h.tui.terminal.output,""); // same CrabWalking frame, not an artificial idle settlement
	await h.emitRaw("tool_execution_end",{toolCallId:"live",isError:false});assert.equal(clock.jobs.size,1);
	await h.emit("session_shutdown");
});

test("bad arguments and no-op controls don't persist entries or disturb other UI",async()=>{
	const {h,clock}=await setup("tui",true);await h.emit("session_start");await h.command("on");assert.equal(h.entries.length,0);
	await h.command("unknown");assert.equal(h.notices.length,1);assert.equal(h.entries.length,0);assert.equal(h.footerSets,1);
	const completions=h.commands.get("clawd").getArgumentCompletions("p");assert.deepEqual(completions,[{value:"pause",label:"pause"},{value:"play",label:"play"}]);
	assert.deepEqual(h.commands.get("clawd").getArgumentCompletions("play Dan"),[{value:"play DancingHappy",label:"DancingHappy"}]);
	assert.deepEqual(h.commands.get("clawd").getArgumentCompletions("play  Dan"),[{value:"play DancingHappy",label:"DancingHappy"}]);
	assert.equal(h.commands.get("clawd").getArgumentCompletions("play ").length,25);
	await h.emit("session_shutdown");clock.advance(20000);assert.equal(clock.jobs.size,0);
});
