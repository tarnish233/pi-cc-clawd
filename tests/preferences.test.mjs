import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";
const { readPreferences,DEFAULT_PREFERENCES,PREFERENCES_ENTRY } = await load("preferences.ts");
const entry = data => ({type:"custom",customType:PREFERENCES_ENTRY,data});

test("defaults are enabled and quiet motion, returned as a copy", () => {
	const p = readPreferences([]); assert.deepEqual(p,{enabled:true,motion:true}); p.enabled=false;
	assert.equal(DEFAULT_PREFERENCES.enabled,true);
});

test("the latest valid preference entry on the supplied branch wins", () => {
	const entries = [entry({enabled:false,motion:true}),entry({enabled:true,motion:false})];
	assert.deepEqual(readPreferences(entries),{enabled:true,motion:false});
	assert.deepEqual(readPreferences(entries.slice(0,1)),{enabled:false,motion:true});
});

test("ignore other extensions, messages, and malformed preferences", () => {
	const entries = [entry({enabled:false,motion:false}), {type:"custom",customType:"other",data:{enabled:true,motion:true}},
		{type:"message",customType:PREFERENCES_ENTRY,data:{enabled:true,motion:true}},entry(null),entry("on"),entry({enabled:"true",motion:true}),entry({enabled:true})];
	assert.deepEqual(readPreferences(entries),{enabled:false,motion:false});
});
