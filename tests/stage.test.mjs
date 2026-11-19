import test from "node:test";
import assert from "node:assert/strict";
import { load, makeTheme } from "./helpers.mjs";
import { decodePng } from "./png-helpers.mjs";
const { ClawdPortrait, CLAWD_COLUMNS, CLAWD_ROWS, OVERLAY_ROWS, STAGE_ROWS } = await load("sprite.ts");
const { ClawdOverlay } = await load("footer-adapter.ts");
const { setCapabilities, setCellDimensions, visibleWidth, stripTerminalSequences } = await load("@earendil-works/pi-tui");
const theme = await makeTheme();

function setup(clip) {
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	const state = { enabled: true, motion: true, pose: "standing", ...(clip ? { clip } : {}) };
	const writes = [];
	const portrait = new ClawdPortrait(() => state, () => theme, () => 32, {
		placeholders: { write: data => writes.push(data), fullRedraws: () => 0 },
		stageRows: STAGE_ROWS,
	});
	return { state, portrait, writes };
}

function uploadedPng(text) {
	const encoded = /;([A-Za-z0-9+/=]+)\x1b\\/.exec(text)?.[1];
	assert(encoded, "no PNG payload in the Kitty sequence");
	return decodePng(Buffer.from(encoded, "base64"));
}

function contentBounds(png) {
	let x0 = png.width, x1 = -1, y0 = png.height, y1 = -1;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			if (png.pixel(x, y)[3] === 0) continue;
			x0 = Math.min(x0, x); x1 = Math.max(x1, x);
			y0 = Math.min(y0, y); y1 = Math.max(y1, y);
		}
	}
	return { x0, x1, y0, y1 };
}

test("the footer paints the bottom two rows of a four-row placeholder stage", () => {
	const { portrait, writes } = setup();
	assert.equal(STAGE_ROWS, CLAWD_ROWS + OVERLAY_ROWS);
	const glyph = portrait.renderGlyph();
	assert.equal(glyph.length, CLAWD_ROWS);
	assert(glyph.every(line => visibleWidth(line) === CLAWD_COLUMNS));
	// Stage rows 2 and 3 use the third and fourth row diacritics.
	assert(glyph[0].includes("\u{10eeee}\u030e"));
	assert(glyph[1].includes("\u{10eeee}\u0310"));
	assert.match(writes[0], /a=T,U=1/);
	assert.match(writes[0], /[,]c=8[,]/);
	assert.match(writes[0], /[,]r=4[,]/);
	const png = uploadedPng(writes[0]);
	assert.equal(png.width, CLAWD_COLUMNS * 9);
	assert.equal(png.height, STAGE_ROWS * 18);
});

test("no footer-enabled canvas ever touches the stage or changes its body size", () => {
	for (const clip of [undefined, { name: "LookingAroundEyesOnly", frame: 0 }, { name: "DancingHappy", frame: 20 }, { name: "Walking", frame: 3 }]) {
		const { portrait, writes } = setup(clip);
		assert.equal(portrait.stageActive(), false, clip?.name);
		assert.equal(portrait.stageTopRows(), 0, clip?.name);
		assert.deepEqual(portrait.renderStageTop(() => "·"), [], clip?.name);
		assert.equal(portrait.renderGlyph().length, CLAWD_ROWS);
		const staged = uploadedPng(writes.at(-1));
		const direct = uploadedPng(portrait.render(80)[0]);
		assert.equal(staged.height, STAGE_ROWS * 18);
		assert.equal(direct.height, CLAWD_ROWS * 18);
		const offset = staged.height - direct.height;
		for (let y = 0; y < direct.height; y++) {
			for (let x = 0; x < direct.width; x++) {
				assert.deepEqual(staged.pixel(x, y + offset), direct.pixel(x, y), `${clip?.name ?? "built-in"} ${x},${y}`);
			}
		}
	}
});

test("tall canvases reach into the stage and only cross the border where they draw", () => {
	const waving = setup({ name: "Waving", frame: 10 });
	assert.equal(waving.portrait.stageActive(), true);
	assert.equal(waving.portrait.stageTopRows(), 1);
	const raised = waving.portrait.renderStageTop(() => "─");
	assert.equal(raised.length, 1);
	assert.equal(visibleWidth(raised[0]), CLAWD_COLUMNS);
	assert(raised[0].includes("\u{10eeee}"));
	assert(raised[0].includes("─"));
	const wavingPng = uploadedPng(waving.writes.at(-1));
	assert(contentBounds(wavingPng).y0 < CLAWD_ROWS * 18, "the raised arm must use the rows above the footer");

	const thinking = setup({ name: "Thinking", frame: 22 });
	assert.equal(thinking.portrait.stageActive(), true);
	assert.equal(thinking.portrait.stageTopRows(), OVERLAY_ROWS);
	const thought = thinking.portrait.renderStageTop(row => row === 1 ? "─" : " ");
	assert.equal(thought.length, OVERLAY_ROWS);
	assert(thought[0].includes("\u{10eeee}"));
	assert(thought[1].includes("\u{10eeee}"));
	assert(thought[1].includes("─"));
});

test("the overlay fills transparent cells with the editor's own border and hides itself", async () => {
	const thinking = setup({ name: "Thinking", frame: 22 });
	const overlay = new ClawdOverlay(() => thinking.portrait, () => theme);
	const lines = overlay.render(CLAWD_COLUMNS);
	assert.equal(lines.length, OVERLAY_ROWS);
	assert.equal(visibleWidth(lines[0]), CLAWD_COLUMNS);
	assert.equal(visibleWidth(lines[1]), CLAWD_COLUMNS);
	assert(lines[1].includes("─"));
	assert(!lines[0].includes("─"));

	const standard = setup();
	assert.deepEqual(new ClawdOverlay(() => standard.portrait, () => theme).render(CLAWD_COLUMNS), []);
	thinking.state.enabled = false;
	assert.deepEqual(overlay.render(CLAWD_COLUMNS), []);
});

test("the stage is unavailable without Kitty placeholders", () => {
	const { portrait, state } = setup({ name: "Waving", frame: 10 });
	setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
	assert.equal(portrait.stageActive(), false);
	assert.equal(portrait.stageTopRows(), 0);
	state.enabled = true;
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: Infinity, heightPx: 18 });
	assert.equal(portrait.stageActive(), false);
});

test("the inline glyph keeps both editor rows and only breaks the border where it draws", () => {
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	const state = { enabled: true, motion: true, pose: "standing" };
	const portrait = new ClawdPortrait(() => state, () => theme, () => 32, {
		placeholders: { write: () => {}, fullRedraws: () => 0 },
		columns: CLAWD_COLUMNS,
		rows: CLAWD_ROWS,
		stageRows: CLAWD_ROWS,
		borderRow: CLAWD_ROWS - 1,
	});
	const lines = portrait.renderInline(row => row === CLAWD_ROWS - 1 ? "─" : " ");
	assert.equal(lines.length, CLAWD_ROWS);
	assert(lines[0].includes("\u{10eeee}"));
	assert(lines[1].includes("\u{10eeee}"));
	const border = [...stripTerminalSequences(lines[1])];
	assert(border.includes("─"));
	assert.equal(visibleWidth(lines[1]), CLAWD_COLUMNS);
	assert.equal(portrait.borderRow(), CLAWD_ROWS - 1);
	state.enabled = false;
	assert.deepEqual(portrait.renderInline(() => "─"), []);
	state.enabled = true;
	setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
	assert.deepEqual(portrait.renderInline(() => "─"), []);
});
