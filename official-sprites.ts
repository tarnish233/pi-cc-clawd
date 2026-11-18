import { readFileSync } from "node:fs";
import type { Rgba } from "./png.ts";

/** Names in the official 6.6395.0 Clawd Quest embedded catalogue. */
export const OFFICIAL_SPRITE_NAMES = [
	"BreakDancing", "Confetti", "CrabWalking", "DancingHappy", "Desktop",
	"Disappointed", "Dizzy", "Excited", "Facepalm", "Hula", "Jumping",
	"JumpingHappy", "Laptop", "Lightbulb", "LookingAround",
	"LookingAroundEyesOnly", "Meditating", "Pointing", "Running", "Spark",
	"Swaying", "Thinking", "Turning", "Walking", "Waving",
] as const;

export type OfficialSpriteName = typeof OFFICIAL_SPRITE_NAMES[number];
export interface OfficialSpriteMetadata {
	name: OfficialSpriteName;
	category: string;
	width: number;
	height: number;
	fps: number;
	frameCount: number;
}
interface SpriteData {
	w: number;
	h: number;
	fps: number;
	cat: string;
	palette: string[];
	base: string;
	deltas: string[];
}
interface IndexedSprite extends SpriteData {
	frames: Uint8Array[];
}
export interface OfficialFrame {
	name: OfficialSpriteName;
	index: number;
	width: number;
	height: number;
	pixels: (Rgba | null)[][];
}

const source = JSON.parse(readFileSync(new URL("./assets/official-sprites.json", import.meta.url), "utf8")) as Record<string, SpriteData>;
const decoded = new Map<OfficialSpriteName, IndexedSprite>();
const TRANSPARENT = 255;

function dataFor(name: OfficialSpriteName): SpriteData {
	const data = source[name];
	if (!data) throw new Error(`Unknown Clawd animation: ${name}`);
	return data;
}

function decode(name: OfficialSpriteName): IndexedSprite {
	const cached = decoded.get(name);
	if (cached) return cached;
	const data = dataFor(name);
	const size = data.w * data.h;
	if (!Number.isInteger(size) || size <= 0 || data.base.length !== size) throw new Error(`Invalid Clawd base: ${name}`);
	const state = Uint8Array.from(data.base, value => {
		if (value === ".") return TRANSPARENT;
		if (!/^[0-9a-z]$/i.test(value)) throw new Error(`Invalid Clawd base: ${name}`);
		const color = Number.parseInt(value, 36);
		if (!Number.isInteger(color) || color >= data.palette.length) throw new Error(`Invalid Clawd palette: ${name}`);
		return color;
	});
	const frames: Uint8Array[] = [state.slice()];
	for (const delta of data.deltas) {
		if (delta) {
			for (const change of delta.split(",")) {
				if (!/^[0-9a-z]+[0-9a-z.]$/i.test(change)) throw new Error(`Invalid Clawd delta: ${name}`);
				const index = Number.parseInt(change.slice(0, -1), 36);
				const value = change.at(-1)!;
				const color = value === "." ? TRANSPARENT : Number.parseInt(value, 36);
				if (!Number.isInteger(index) || index < 0 || index >= size || !Number.isInteger(color) || (color !== TRANSPARENT && color >= data.palette.length)) {
					throw new Error(`Invalid Clawd delta: ${name}`);
				}
				state[index] = color;
			}
		}
		frames.push(state.slice());
	}
	const result = { ...data, frames };
	decoded.set(name, result);
	return result;
}

export function officialSpriteMetadata(name: OfficialSpriteName): OfficialSpriteMetadata {
	const data = dataFor(name);
	return { name, category: data.cat, width: data.w, height: data.h, fps: data.fps, frameCount: data.deltas.length + 1 };
}

/** Tall props/backgrounds are decoded but deliberately not placed in the 8×2 footer. */
export const FOOTER_SPRITE_NAMES: readonly OfficialSpriteName[] = OFFICIAL_SPRITE_NAMES.filter(
	name => officialSpriteMetadata(name).height <= 18,
);
export const SKIPPED_FOOTER_SPRITE_NAMES: readonly OfficialSpriteName[] = OFFICIAL_SPRITE_NAMES.filter(
	name => !FOOTER_SPRITE_NAMES.includes(name),
);

export function isOfficialSpriteName(value: string): value is OfficialSpriteName {
	return (OFFICIAL_SPRITE_NAMES as readonly string[]).includes(value);
}

export function isFooterSpriteName(value: string): value is OfficialSpriteName {
	return (FOOTER_SPRITE_NAMES as readonly string[]).includes(value);
}

function rgba(hex: string): Rgba {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid Clawd colour");
	return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), 255];
}

/** Decode one immutable indexed frame into ordinary RGBA pixels only when rendered. */
export function officialSpriteFrame(name: OfficialSpriteName, index: number): OfficialFrame {
	const sprite = decode(name);
	if (!Number.isInteger(index) || index < 0 || index >= sprite.frames.length) throw new RangeError(`Invalid ${name} frame: ${index}`);
	const indexed = sprite.frames[index];
	const palette = sprite.palette.map(rgba);
	const pixels: (Rgba | null)[][] = [];
	for (let y = 0; y < sprite.h; y++) {
		const row: (Rgba | null)[] = [];
		for (let x = 0; x < sprite.w; x++) {
			const color = indexed[y * sprite.w + x];
			row.push(color === TRANSPARENT ? null : palette[color]);
		}
		pixels.push(row);
	}
	return { name, index, width: sprite.w, height: sprite.h, pixels };
}
