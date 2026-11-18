import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {FakeClock,extensionHarness,load,root} from "./helpers.mjs";
const {createClawdExtension}=await load("index.ts");
const {CLAWD_PLACEHOLDER}=await load("footer-adapter.ts");
const ccstyle=[
	process.env.PI_CC_CLAWD_CCSTYLE_FOOTER,
	"/Users/fulei/.pi/agent/npm/node_modules/pi-cc-extensions/extensions/feature/shell/footer.ts",
	path.resolve(root,"../pi-cc-extensions/extensions/feature/shell/footer.ts"),
].filter(value=>value&&fs.existsSync(value))[0];

test("the actual installed pi-cc-extensions footer keeps its two rows and gains a graphical chip",{skip:!fs.existsSync(ccstyle)},async()=>{
	const previous=process.env.PI_CODING_AGENT_DIR;
	const temp=fs.mkdtempSync(path.join(os.tmpdir(),"pi-cc-clawd-ccstyle-"));process.env.PI_CODING_AGENT_DIR=temp;
	const h=await extensionHarness();const clock=new FakeClock();
	try {
		// Match the supported package order: Clawd prepares before ccstyle's startup handler.
		createClawdExtension({schedule:clock.schedule,random:()=>0})(h.pi);
		const customFooter=(await load(ccstyle)).default;
		customFooter(h.pi);
		await h.emitRaw("session_start");
		const original=h.footer.render(100);
		assert.equal(original.length,2);
		assert(original[0].includes("no-model"));assert(!original[1].includes(CLAWD_PLACEHOLDER));
		await h.emitRaw("resources_discover");
		const integrated=h.footer.render(100);
		assert.equal(integrated.length,2);assert(integrated[0].startsWith(original[0]));
		assert(integrated[0].includes("\u{10eeee}"));assert(integrated.every(line=>!line.includes("\x1b_G")));assert(integrated[1].startsWith(original[1]));
		assert(!integrated[1].includes(CLAWD_PLACEHOLDER));
		assert.equal(h.editorSets,0);assert.equal(h.widget,undefined);assert.equal(clock.jobs.size,1);
		await h.command("off");assert(!h.footer.render(100)[1].includes(CLAWD_PLACEHOLDER));
		await h.command("on");assert(h.footer.render(100)[0].includes("\u{10eeee}"));
		await h.emit("session_shutdown");assert.equal(clock.jobs.size,0);
	} finally {
		h.footer?.dispose?.();h.resetEditor();
		fs.rmSync(temp,{recursive:true,force:true});
		if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;
	}
});
