import { crc32, deflateSync } from "node:zlib";

export type Rgba = readonly [number, number, number, number];
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer): Buffer {
	const name = Buffer.from(type, "ascii");
	const header = Buffer.alloc(8);
	header.writeUInt32BE(data.length, 0);
	name.copy(header, 4);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
	return Buffer.concat([header, data, checksum]);
}

/** Nearest-neighbor, ONE scale for both axes; transparent padding, feet at bottom. */
export function encodePixelPng<T extends string>(
	pixels: readonly (readonly (T | null)[])[],
	colors: Readonly<Record<T, Rgba>>,
	width: number,
	height: number,
): Buffer {
	return encodeRgbaPng(pixels.map(row => row.map(pixel => pixel === null ? null : colors[pixel])), width, height);
}

/** RGBA variant shared by the small built-in model and official palette frames. */
export function encodeRgbaPng(
	pixels: readonly (readonly (Rgba | null)[])[],
	width: number,
	height: number,
): Buffer {
	const sourceHeight = pixels.length;
	const sourceWidth = pixels[0]?.length ?? 0;
	if (!sourceWidth || pixels.some(row => row.length !== sourceWidth)) throw new Error("Invalid pixel matrix");
	if (![width, height].every(size => Number.isInteger(size) && size >= 1 && size <= 1024)) throw new Error("Invalid PNG size");
	const scale = Math.min(width / sourceWidth, height / sourceHeight);
	const left = (width - sourceWidth * scale) / 2;
	const top = height - sourceHeight * scale;
	const stride = width * 4 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const sourceY = Math.floor((y + 0.5 - top) / scale);
		if (sourceY < 0 || sourceY >= sourceHeight) continue;
		for (let x = 0; x < width; x++) {
			const sourceX = Math.floor((x + 0.5 - left) / scale);
			if (sourceX < 0 || sourceX >= sourceWidth) continue;
			const pixel = pixels[sourceY][sourceX];
			if (pixel === null) continue;
			raw.set(pixel, y * stride + 1 + x * 4);
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // 8 bits per channel
	header[9] = 6; // RGBA; transparent background, no terminal-themed panel
	return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
