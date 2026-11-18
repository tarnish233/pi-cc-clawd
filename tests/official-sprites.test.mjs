import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load, root } from "./helpers.mjs";
const {
	OFFICIAL_SPRITE_NAMES, FOOTER_SPRITE_NAMES, STAGE_SPRITE_NAMES,
	officialSpriteMetadata, officialSpriteFrame, isOfficialSpriteName, isFooterSpriteName, isStageSpriteName,
} = await load("official-sprites.ts");
const { drawClawd } = await load("sprite.ts");

test("all 25 official clips decode every base and delta frame without malformed pixels", () => {
	assert.equal(OFFICIAL_SPRITE_NAMES.length, 25);
	for (const name of OFFICIAL_SPRITE_NAMES) {
		const metadata = officialSpriteMetadata(name);
		assert(metadata.frameCount > 0);
		assert.equal(metadata.fps, 12);
		let changed = false;
		let previous;
		for (let index = 0; index < metadata.frameCount; index++) {
			const frame = officialSpriteFrame(name, index);
			assert.equal(frame.width, metadata.width);
			assert.equal(frame.height, metadata.height);
			assert.equal(frame.pixels.length, metadata.height);
			assert(frame.pixels.every(row => row.length === metadata.width));
			assert(frame.pixels.flat().every(pixel => pixel === null || (pixel.length === 4 && pixel[3] === 255)));
			const flat = JSON.stringify(frame.pixels);
			if (previous !== undefined && flat !== previous) changed = true;
			previous = flat;
		}
		assert.equal(changed, true, `${name} should contain actual animation deltas`);
	}
});

test("fifteen short canvases keep the footer-only framing and ten taller ones use the stage", () => {
	assert.equal(FOOTER_SPRITE_NAMES.length, 15);
	assert.equal(STAGE_SPRITE_NAMES.length, 10);
	assert.deepEqual(STAGE_SPRITE_NAMES, [
		"BreakDancing", "Confetti", "Jumping", "JumpingHappy", "Laptop",
		"Lightbulb", "Pointing", "Spark", "Thinking", "Waving",
	]);
	for (const name of OFFICIAL_SPRITE_NAMES) {
		assert.equal(isOfficialSpriteName(name.toLowerCase()), false);
		assert.equal(isFooterSpriteName(name), officialSpriteMetadata(name).height <= 18);
		assert.equal(isStageSpriteName(name), officialSpriteMetadata(name).height > 18);
		assert.equal(isFooterSpriteName(name) !== isStageSpriteName(name), true);
	}
	assert.equal(isOfficialSpriteName("Desktop"), true);
	assert.equal(isOfficialSpriteName("NotAClawd"), false);
});

test("the official standing base preserves the canonical body and eyes", () => {
	const official = officialSpriteFrame("LookingAroundEyesOnly", 0).pixels;
	const builtIn = drawClawd("standing");
	assert.equal(official.length, builtIn.length);
	for (let y = 0; y < builtIn.length; y++) {
		for (let x = 0; x < builtIn[y].length; x++) {
			const pixel = official[y][x];
			if (builtIn[y][x] === null) assert.equal(pixel, null);
			else if (builtIn[y][x] === "body") assert.deepEqual(pixel, [217, 119, 87, 255]);
			else assert.deepEqual(pixel, [20, 20, 19, 255]);
		}
	}
});

test("malformed base and delta characters are rejected instead of becoming palette zero",async()=>{
	for(const [kind,expected] of [["base",/Invalid Clawd base/],["delta",/Invalid Clawd delta/]]){
		const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pi-cc-clawd-invalid-sprite-"));
		try{
			fs.mkdirSync(path.join(dir,"assets"));
			fs.copyFileSync(path.join(root,"official-sprites.ts"),path.join(dir,"official-sprites.ts"));
			const data=JSON.parse(fs.readFileSync(path.join(root,"assets/official-sprites.json"),"utf8"));
			if(kind==="base")data.LookingAroundEyesOnly.base="$"+data.LookingAroundEyesOnly.base.slice(1);
			else data.LookingAroundEyesOnly.deltas[0]="0?";
			fs.writeFileSync(path.join(dir,"assets/official-sprites.json"),JSON.stringify(data));
			const mutated=await load(path.join(dir,"official-sprites.ts"));
			assert.throws(()=>mutated.officialSpriteFrame("LookingAroundEyesOnly",1),expected);
		}finally{fs.rmSync(dir,{recursive:true,force:true});}
	}
});

test("metadata and frame bounds match the extracted official catalogue", () => {
	assert.deepEqual(officialSpriteMetadata("BreakDancing"), {
		name: "BreakDancing", category: "Core", width: 34, height: 32, fps: 12, frameCount: 149,
	});
	assert.equal(officialSpriteMetadata("Desktop").frameCount, 88);
	assert.throws(() => officialSpriteFrame("Desktop", -1), /Invalid Desktop frame/);
	assert.throws(() => officialSpriteFrame("Desktop", 88), /Invalid Desktop frame/);
	// Tall clips remain decodable for future larger placements, just not footer-enabled.
	assert.equal(officialSpriteFrame("Confetti", 0).height, 37);
});
