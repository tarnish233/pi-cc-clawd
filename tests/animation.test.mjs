import test from "node:test";
import assert from "node:assert/strict";
import { FakeClock, load } from "./helpers.mjs";
const { ClawdAnimation } = await load("animation.ts");

function setup(random = () => 0, options = {}) {
	const clock = new FakeClock();
	let changes = 0;
	const animation = new ClawdAnimation(() => changes++, clock.schedule, random, { now: () => clock.time, ...options });
	return { clock, animation, get changes() { return changes; } };
}

test("no resources in constructor; start is idempotent", () => {
	const { clock, animation } = setup();
	assert.equal(clock.jobs.size, 0);
	animation.start(); animation.start();
	assert.equal(clock.jobs.size, 1);
	animation.dispose(); assert.equal(clock.jobs.size, 0);
});

test("blinks run on their own 4-7 second clock", () => {
	const h = setup(); h.animation.start();
	h.clock.advance(3999);
	assert.equal(h.animation.getState().pose, "standing"); assert.equal(h.changes, 0);
	h.clock.advance(1); assert.equal(h.animation.getState().pose, "blink");
	assert.equal(h.clock.jobs.size, 1);
	h.clock.advance(159); assert.equal(h.animation.getState().pose, "blink");
	h.clock.advance(1); assert.equal(h.animation.getState().pose, "standing");
	assert.equal(h.changes, 2); assert.equal(h.clock.jobs.size, 1);
	h.animation.dispose();
});

for (const [choice,pose] of [[0,"look-left"],[4/40,"look-right"]]) {
	test("occasional " + pose + " has a short fixed hold", () => {
		// wake (2), the 4 s blink's next-blink draw (1), the act delay (1), then the pick (1)
		const values = [0,0,0,0,choice]; const h = setup(() => values.shift() ?? 0);
		h.animation.start(); h.clock.advance(6000);
		assert.equal(h.animation.getState().pose, pose);
		h.clock.advance(650); assert.equal(h.animation.getState().pose, "standing");
		assert.equal(h.clock.jobs.size, 1); h.animation.dispose();
	});
}

test("pause mid-blink restores standing and cancels all autonomous timers", () => {
	const h = setup(); h.animation.start(); h.animation.blink();
	h.animation.setPreferences({ enabled:true, motion:false });
	assert.equal(h.animation.getState().pose, "standing"); assert.equal(h.clock.jobs.size, 0);
	const changes = h.changes; h.clock.advance(20000); assert.equal(h.changes, changes);
});

test("a manual blink while paused finishes without starting autonomous motion", () => {
	const h = setup(); h.animation.setPreferences({enabled:true,motion:false}); h.animation.start();
	assert.equal(h.clock.jobs.size, 0); h.animation.blink(); assert.equal(h.clock.jobs.size, 1);
	h.clock.advance(160); assert.equal(h.animation.getState().pose, "standing");
	assert.equal(h.animation.getState().motion, false); assert.equal(h.clock.jobs.size, 0);
});

test("hidden mascot has no timer; re-enabling starts only one", () => {
	const h = setup(); h.animation.start();
	h.animation.setPreferences({ enabled:false, motion:true }); h.animation.blink();
	assert.equal(h.clock.jobs.size, 0); assert.equal(h.animation.getState().enabled, false);
	h.animation.setPreferences({ enabled:true, motion:true }); assert.equal(h.clock.jobs.size, 1);
	h.animation.dispose();
});

test("unchanged preferences don't reset the blink clock", () => {
	const h = setup(); h.animation.start(); h.clock.advance(3999);
	h.animation.setPreferences({ enabled:true, motion:true }); h.clock.advance(1);
	assert.equal(h.animation.getState().pose, "blink"); h.animation.dispose();
});

test("cancelled callbacks cannot reschedule after pause or shutdown", () => {
	for (const stop of [a => a.setPreferences({enabled:true,motion:false}), a => a.dispose()]) {
		const h = setup(); h.animation.start(); const callback = [...h.clock.jobs.values()][0].callback;
		stop(h.animation); const changes = h.changes; callback();
		assert.equal(h.clock.jobs.size, 0); assert.equal(h.changes, changes);
	}
});

test("disposed animation cannot be restarted or manually animated", () => {
	const h = setup(); h.animation.start(); h.animation.dispose(); h.animation.dispose();
	h.animation.start(); h.animation.blink(); h.animation.setPreferences({enabled:true,motion:true});
	assert.equal(h.clock.jobs.size, 0); assert.equal(h.animation.getState().enabled, false);
});

test("agent work loops Desktop frames instead of scheduling idle motions", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	assert.deepEqual(h.animation.getState().clip, { name:"Desktop", frame:2 });
	assert.equal(h.animation.getState().activity, "working");
	h.clock.advance(84); assert.equal(h.animation.getState().clip.name, "Desktop");
	assert(h.animation.getState().clip.frame > 2); assert.equal(h.clock.jobs.size, 1);
	h.animation.agentSettled(false);
	assert.deepEqual(h.animation.getState().clip, { name:"DancingHappy", frame:0 });
	h.clock.advance(3400);assert.equal(h.animation.getState().activity, "idle");
	assert.equal(h.animation.getState().clip, undefined);assert.equal(h.clock.jobs.size, 1);
	h.animation.dispose();
});

test("parallel tools share CrabWalking and return to Desktop only after the last one", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a");assert.deepEqual(h.animation.getState().clip,{name:"CrabWalking",frame:0});
	h.clock.advance(84);const frame=h.animation.getState().clip.frame;
	h.animation.toolStart("b");assert.equal(h.animation.getState().clip.frame,frame);
	h.animation.toolEnd("a",false);assert.equal(h.animation.getState().activity,"tools");assert.equal(h.animation.getState().clip.frame,frame);
	h.animation.toolEnd("b",false);
	assert.equal(h.animation.getState().clip.name,"CrabWalking");
	h.clock.advance(17 * 84);
	assert.equal(h.animation.getState().clip.name,"CrabWalking");
	h.clock.advance(2 * 84);
	assert.deepEqual(h.animation.getState().clip,{name:"Desktop",frame:2});
	h.animation.dispose();
});

test("compaction and errors use one-shot or looping clips with deterministic recovery", () => {
	const h=setup();h.animation.start();h.animation.compactStart();
	assert.deepEqual(h.animation.getState().clip,{name:"Meditating",frame:0});
	h.animation.compactFailed(false);assert.deepEqual(h.animation.getState().clip,{name:"Facepalm",frame:0});
	h.clock.advance(3000);assert.equal(h.animation.getState().activity,"idle");assert.equal(h.animation.getState().clip,undefined);
	h.animation.agentStart();h.animation.compactStart();h.animation.compactEnd(true);
	assert.deepEqual(h.animation.getState().clip,{name:"Desktop",frame:2});h.animation.dispose();
});

test("pause suppresses autonomous state clips and resume restores the latest agent state", () => {
	const h=setup();h.animation.start();h.animation.agentStart();
	h.animation.setPreferences({enabled:true,motion:false});assert.equal(h.animation.getState().clip,undefined);assert.equal(h.clock.jobs.size,0);
	h.animation.toolStart("a");assert.equal(h.animation.getState().activity,"tools");assert.equal(h.clock.jobs.size,0);
	h.animation.setPreferences({enabled:true,motion:true});assert.deepEqual(h.animation.getState().clip,{name:"CrabWalking",frame:0});
	h.animation.dispose();
});

test("a failed turn is never converted into a success dance by final settlement", () => {
	const h=setup();h.animation.start();h.animation.agentStart();h.animation.turnError();
	h.clock.advance(84);const frame=h.animation.getState().clip.frame;
	h.animation.agentSettled(false);assert.equal(h.animation.getState().activity,"error");
	assert.deepEqual(h.animation.getState().clip,{name:"Facepalm",frame}); // do not restart or celebrate
	h.clock.advance(3000);assert.equal(h.animation.getState().activity,"idle");assert.equal(h.animation.getState().clip,undefined);
	h.animation.compactStart();h.animation.compactEnd(false);assert.equal(h.animation.getState().activity,"success"); // failed was consumed once
	h.animation.agentStart();h.animation.agentSettled(false);assert.equal(h.animation.getState().activity,"success");
	h.animation.dispose();
});

test("threshold compaction during an active run returns to work, not idle or success", () => {
	const h=setup();h.animation.start();h.animation.agentStart();h.animation.compactStart();h.animation.compactEnd(false);
	assert.equal(h.animation.getState().activity,"working");assert.deepEqual(h.animation.getState().clip,{name:"Desktop",frame:2});
	h.clock.advance(3400);assert.equal(h.animation.getState().activity,"working");assert.equal(h.animation.getState().clip.name,"Desktop");
	h.animation.dispose();
});

test("a same-named manual clip cannot suppress or duplicate a real error transition", () => {
	const h=setup();h.animation.start();h.animation.agentStart();h.animation.turnError();
	h.animation.playOfficial("Facepalm");h.clock.advance(84);assert.equal(h.animation.getState().clip.frame,1);
	h.animation.agentSettled(false);assert.deepEqual(h.animation.getState().clip,{name:"Facepalm",frame:0});
	h.clock.advance(3000);assert.equal(h.animation.getState().activity,"idle");assert.equal(h.animation.getState().clip,undefined);
	h.animation.dispose();
});

test("manual official clips play any canvas and do not resume motion while paused", () => {
	const h=setup();h.animation.setPreferences({enabled:true,motion:false});h.animation.start();
	assert.equal(h.animation.playOfficial("Hula"),true);assert.deepEqual(h.animation.getState().clip,{name:"Hula",frame:0});
	assert.equal(h.animation.playOfficial("Waving"),true);assert.deepEqual(h.animation.getState().clip,{name:"Waving",frame:0});
	h.clock.advance(4600);assert.equal(h.animation.getState().clip,undefined);assert.equal(h.clock.jobs.size,0);
	h.animation.dispose();
});

test("each tool family picks its own official clip", () => {
	const cases = [
		["Read", "LookingAround"], ["Grep", "LookingAround"],
		["Edit", "Laptop"], ["Write", "Laptop"],
		["Bash", "Running"], ["WebSearch", "LookingAroundEyesOnly"], ["fetch_content", "LookingAroundEyesOnly"],
		["Agent", "Waving"], ["AskUserQuestion", "Pointing"], ["TodoWrite", "Thinking"],
		["mcp__custom__tool", "CrabWalking"],
	];
	for (const [tool, clip] of cases) {
		const h = setup(); h.animation.start(); h.animation.agentStart();
		h.animation.toolStart("t", tool);
		assert.deepEqual(h.animation.getState().clip, { name: clip, frame: 0 }, `${tool} must run ${clip}`);
		h.animation.dispose();
	}
});

test("a tool clip is held before the next tool family replaces it", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a", "Read");
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(2 * 84);
	h.animation.toolStart("b", "Bash");
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(10 * 84);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(10 * 84);
	assert.equal(h.animation.getState().clip.name, "Running");
	h.animation.dispose();
});

test("a millisecond tool still gets its full minimum hold before the working loop", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a", "Read"); h.clock.advance(84);
	h.animation.toolEnd("a", false);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(17 * 84);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(2 * 84);
	assert.deepEqual(h.animation.getState().clip, { name: "Desktop", frame: 2 });
	assert.equal(h.animation.getState().activity, "working");
	h.animation.dispose();
});

test("a tool that already had its hold returns after the four-frame gap", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a", "Read"); h.clock.advance(24 * 84);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.animation.toolEnd("a", false);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(3 * 84);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(2 * 84);
	assert.deepEqual(h.animation.getState().clip, { name: "Desktop", frame: 2 });
	h.animation.dispose();
});

test("a same-family tool during the gap continues the clip instead of restarting it", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a", "Read"); h.clock.advance(10 * 84);
	const frame = h.animation.getState().clip.frame;
	h.animation.toolEnd("a", false);
	h.animation.toolStart("b", "Grep");
	assert.deepEqual(h.animation.getState().clip, { name: "LookingAround", frame });
	h.clock.advance(84);
	assert.equal(h.animation.getState().clip.frame, frame + 1);
	h.animation.dispose();
});

test("an aborted turn plays Disappointed instead of dancing or vanishing", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.agentSettled(true);
	assert.equal(h.animation.getState().activity, "interrupted");
	assert.deepEqual(h.animation.getState().clip, { name: "Disappointed", frame: 0 });
	h.clock.advance(44 * 84);
	assert.equal(h.animation.getState().activity, "idle");
	assert.equal(h.animation.getState().clip, undefined);
	assert.equal(h.clock.jobs.size, 1);
	h.animation.dispose();
});

test("a busy turn ends with the confetti scene instead of the usual dance", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	for (let i = 0; i < 12; i++) {
		h.animation.toolStart(`t${i}`, "Read");
		h.animation.toolEnd(`t${i}`, false);
	}
	h.animation.agentSettled(false);
	assert.equal(h.animation.getState().activity, "success");
	h.clock.advance(20 * 84);
	assert.equal(h.animation.getState().clip.name, "Confetti");
	h.animation.dispose();
});

test("petting works while autonomous motion is paused", () => {
	const h = setup(); h.animation.setPreferences({ enabled: true, motion: false }); h.animation.start();
	assert.equal(h.clock.jobs.size, 0);
	assert.equal(h.animation.pet(), true);
	assert.equal(h.animation.getState().clip.name, "Excited");
	h.clock.advance(10_000);
	assert.equal(h.animation.getState().clip, undefined);
	assert.equal(h.clock.jobs.size, 0);
	assert.equal(h.animation.getState().motion, false);
	h.animation.dispose();
});

test("crowded context gives one dizzy reaction when idle", () => {
	const h = setup(() => 0, { contextPercent: () => 90 });
	h.animation.start();
	assert.deepEqual(h.animation.getState().clip, { name: "Dizzy", frame: 0 });
	assert.equal(h.clock.jobs.size, 1);
	h.clock.advance(5000);
	assert.equal(h.clock.jobs.size >= 1, true); // Dizzy ended and the idle timer took over
	h.animation.dispose();
});

test("ten quiet minutes end in the slow sleep loop, and an event wakes it", () => {
	const clock = new FakeClock();
	const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
	let changes = 0;
	const animation = new ClawdAnimation(() => changes++, clock.schedule, () => 0, { now: () => noon + clock.time });
	animation.start();
	clock.advance(10 * 60_000 + 20_000);
	assert.equal(animation.getState().activity, "sleeping");
	assert.equal(animation.getState().clip.name, "Meditating");
	animation.toolStart("a", "Read");
	assert.equal(animation.getState().activity, "tools");
	assert.equal(animation.getState().clip.name, "LookingAround");
	animation.dispose();
});

test("a steer prompt hops only while a turn is streaming", () => {
	const h = setup(); h.animation.start();
	h.animation.userInput("hello"); // idle: agent_start follows, so no lost hop
	assert.equal(h.animation.getState().clip, undefined);
	h.animation.agentStart();
	h.animation.userInput("/clawd"); // commands are not prompts
	assert.deepEqual(h.animation.getState().clip, { name: "Desktop", frame: 2 });
	h.animation.userInput("steer this");
	assert.deepEqual(h.animation.getState().clip, { name: "Jumping", frame: 0 });
	h.clock.advance(21 * 84);
	assert.equal(h.animation.getState().activity, "working");
	assert.equal(h.animation.getState().clip.name, "Desktop");
	h.animation.dispose();
});

test("a two-minute turn gets tired and sways", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	assert.equal(h.animation.getState().clip.name, "Desktop");
	h.clock.advance(120_000 + 84);
	assert.equal(h.animation.getState().activity, "working");
	assert.equal(h.animation.getState().clip.name, "Swaying");
	h.animation.dispose();
});

test("pausing or hiding during a tool keeps it still when the tool ends", () => {
	for (const preferences of [{ enabled: true, motion: false }, { enabled: false, motion: true }]) {
		const h = setup(); h.animation.start(); h.animation.agentStart(); h.animation.toolStart("a", "Read");
		h.animation.setPreferences(preferences);
		assert.equal(h.clock.jobs.size, 0);
		h.animation.toolEnd("a", false);
		assert.equal(h.animation.getState().clip, undefined);
		assert.equal(h.clock.jobs.size, 0);
		const changes = h.changes;
		h.clock.advance(60_000);
		assert.equal(h.changes, changes); // no hidden 12 fps loop
		h.animation.dispose();
	}
});

test("a crowded crossing waits while paused and plays after resume", () => {
	const h = setup(() => 0, { contextPercent: () => 90 });
	h.animation.setPreferences({ enabled: true, motion: false });
	h.animation.start();
	assert.equal(h.animation.getState().clip, undefined);
	h.clock.advance(5000);
	assert.equal(h.animation.getState().clip, undefined);
	h.animation.setPreferences({ enabled: true, motion: true });
	assert.equal(h.animation.getState().clip.name, "Dizzy");
	h.animation.dispose();
});

test("unknown tool names never fall through to Object.prototype", () => {
	for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "mcp__odd"]) {
		const h = setup(); h.animation.start(); h.animation.agentStart();
		h.animation.toolStart("t", name);
		assert.equal(h.animation.getState().clip.name, "CrabWalking", `${name} must use the fallback`);
		h.animation.dispose();
	}
});

test("a manual blink wakes the sleeping mascot", () => {
	const clock = new FakeClock();
	const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
	const animation = new ClawdAnimation(() => {}, clock.schedule, () => 0, { now: () => noon + clock.time });
	animation.start();
	clock.advance(10 * 60_000 + 20_000);
	assert.equal(animation.getState().activity, "sleeping");
	animation.blink();
	assert.equal(animation.getState().activity, "idle");
	assert.equal(animation.getState().pose, "blink");
	clock.advance(160);
	assert.equal(animation.getState().pose, "standing");
	assert.equal(animation.getState().activity, "idle");
	animation.dispose();
});

test("a quick final tool keeps its hold before the success dance", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("a", "Read");
	h.clock.advance(2 * 84);
	h.animation.toolEnd("a", false);
	h.clock.advance(84);
	h.animation.agentSettled(false);
	assert.equal(h.animation.getState().activity, "success");
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(16 * 84);
	assert.equal(h.animation.getState().clip.name, "LookingAround");
	h.clock.advance(84);
	assert.deepEqual(h.animation.getState().clip, { name: "DancingHappy", frame: 0 });
	h.animation.dispose();
});

test("a success after a tool error is not lost behind the Facepalm one-shot", () => {
	const h = setup(); h.animation.start(); h.animation.agentStart();
	h.animation.toolStart("t", "Read");
	h.animation.toolEnd("t", true);
	assert.equal(h.animation.getState().clip.name, "Facepalm");
	h.animation.agentSettled(false);
	assert.equal(h.animation.getState().activity, "success");
	assert.deepEqual(h.animation.getState().clip, { name: "DancingHappy", frame: 0 });
	h.animation.dispose();
});
