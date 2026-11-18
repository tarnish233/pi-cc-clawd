import test from "node:test";
import assert from "node:assert/strict";
import { FakeClock, load } from "./helpers.mjs";
const { ClawdAnimation } = await load("animation.ts");

function setup(random = () => 0) {
	const clock = new FakeClock();
	let changes = 0;
	const animation = new ClawdAnimation(() => changes++, clock.schedule, random);
	return { clock, animation, get changes() { return changes; } };
}

test("no resources in constructor; start is idempotent", () => {
	const { clock, animation } = setup();
	assert.equal(clock.jobs.size, 0);
	animation.start(); animation.start();
	assert.equal(clock.jobs.size, 1);
	animation.dispose(); assert.equal(clock.jobs.size, 0);
});

test("quiet for seconds, brief blink, then exactly one next timer", () => {
	const h = setup(); h.animation.start();
	h.clock.advance(4499);
	assert.equal(h.animation.getState().pose, "standing"); assert.equal(h.changes, 0);
	h.clock.advance(1); assert.equal(h.animation.getState().pose, "blink");
	assert.equal(h.clock.jobs.size, 1);
	h.clock.advance(159); assert.equal(h.animation.getState().pose, "blink");
	h.clock.advance(1); assert.equal(h.animation.getState().pose, "standing");
	assert.equal(h.changes, 2); assert.equal(h.clock.jobs.size, 1);
	h.animation.dispose();
});

for (const [choice,pose] of [[0.75,"look-left"],[0.9,"look-right"]]) {
	test("occasional " + pose + " has a short fixed hold", () => {
		const values = [0,choice,0]; const h = setup(() => values.shift() ?? 0);
		h.animation.start(); h.clock.advance(4500);
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

test("unchanged preferences don't reset the quiet interval", () => {
	const h = setup(); h.animation.start(); h.clock.advance(4000);
	h.animation.setPreferences({ enabled:true, motion:true }); h.clock.advance(500);
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
	h.animation.toolEnd("b",false);assert.deepEqual(h.animation.getState().clip,{name:"Desktop",frame:2});
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
