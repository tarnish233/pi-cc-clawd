import type { Theme } from "@earendil-works/pi-coding-agent";
import { allocateImageId, encodeKitty, getCapabilities, getCellDimensions, Image, rgbColor, type Component } from "@earendil-works/pi-tui";
import type { ClawdPose, ClawdState } from "./animation.ts";
import { FOOTER_MAX_CANVAS_ROWS, officialSpriteFrame } from "./official-sprites.ts";
import { encodeRgbaPng, fitRgba, type Rgba } from "./png.ts";

export const SOURCE_COLUMNS = 24;
export const SOURCE_ROWS = 16;
export const CLAWD_COLUMNS = 8;
export const CLAWD_ROWS = 2;
/** Extra canvas rows borrowed from the editor's blank right margin (see ClawdOverlay). */
export const OVERLAY_ROWS = 2;
export const STAGE_ROWS = CLAWD_ROWS + OVERLAY_ROWS;
/** Nominal footprint of the below-editor text widget; it renders TEXT_ROWS rows. */
export const FALLBACK_COLUMNS = 4;
export const FALLBACK_ROWS = 1;
export const TEXT_COLUMNS = SOURCE_COLUMNS / 2;
export const TEXT_ROWS = SOURCE_ROWS / 4;
export const MIN_COLUMNS = 28;
export const MIN_ROWS = 16;

export type Pixel = "body" | "eye" | null;
export const PIXEL_COLORS: Readonly<Record<Exclude<Pixel, null>, Rgba>> = {
	body: [217, 119, 87, 255],
	eye: [20, 20, 19, 255],
};
interface PortraitFrame {
	key: string;
	width: number;
	height: number;
	pixels: (Rgba | null)[][];
}

function portraitFrame(state: ClawdState): PortraitFrame {
	if (state.clip) {
		const frame = officialSpriteFrame(state.clip.name, state.clip.frame);
		return { ...frame, key: `official:${frame.name}:${frame.index}` };
	}
	return {
		key: state.pose,
		width: SOURCE_COLUMNS,
		height: SOURCE_ROWS,
		pixels: drawClawd(state.pose).map(row => row.map(pixel => pixel === null ? null : PIXEL_COLORS[pixel])),
	};
}

/** Canonical 24 x 16 Clawd silhouette. Never reshape parts to fit terminal cells. */
export function drawClawd(pose: ClawdPose): Pixel[][] {
	const pixels: Pixel[][] = Array.from({ length: SOURCE_ROWS }, () => Array<Pixel>(SOURCE_COLUMNS).fill(null));
	const rect = (x: number, y: number, width: number, height: number, color: Pixel = "body"): void => {
		for (let row = y; row < y + height; row++) {
			for (let col = x; col < x + width; col++) pixels[row][col] = color;
		}
	};
	rect(4, 0, 16, 12);
	rect(0, 4, 24, 4);
	for (const x of [4, 8, 14, 18]) rect(x, 12, 2, 4);
	if (pose !== "blink") {
		const look = pose === "look-left" ? -2 : pose === "look-right" ? 2 : 0;
		rect(6 + look, 2, 2, 2, "eye");
		rect(16 + look, 2, 2, 2, "eye");
	}
	return pixels;
}

export interface KittyPlaceholderTransport {
	/** Upload outside rendered text lines, keeping both footer rows selectable. */
	write(data: string): void;
	/** Pi clears uploaded images on a full redraw; restore them immediately afterwards. */
	fullRedraws(): number;
}

export interface PortraitOptions {
	/** Text remains a lossless fallback for terminals without Kitty graphics. */
	mode?: "auto" | "text";
	/** Explicit dimensions for development previews; the footer uses 8×2 and its widget fallback 4×1. */
	columns?: number;
	rows?: number;
	/** Padding belongs to the caller, e.g. a footer chip or an editor wrapper. */
	inset?: number;
	/** Footer-only Unicode placeholders; the below-editor fallback keeps direct images. */
	placeholders?: KittyPlaceholderTransport;
	/** Canvas rows when placeholders span more than the footer, e.g. the editor overlay stage. */
	stageRows?: number;
	/** Stage row holding the editor's bottom border; `-1` disables border preservation. */
	borderRow?: number;
}

const KITTY_PLACEHOLDER = "\u{10eeee}";
// kitty's rowcolumn-diacritics.txt, indices 0–7. Explicit coordinates avoid
// relying on left-to-right inheritance when Pi slices or highlights a row.
const ROW_COLUMN_DIACRITICS = ["\u0305", "\u030d", "\u030e", "\u0310", "\u0312", "\u033d", "\u033e", "\u033f"];

/** The same source pixels, rendered either as a small PNG or lossless half-blocks. */
export class ClawdPortrait implements Component {
	private cachedTheme: Theme | undefined;
	private cells = new Map<string, string>();
	private imageId: number | undefined;
	private imageSizeKey: string | undefined;
	private images = new Map<string, Image>();
	private lastImagePose: string | undefined;
	private placeholderImages = new Map<string, string>();
	private placeholderId: number | undefined;
	private placeholderUploadedKey: string | undefined;
	private placeholderRenderedKey: string | undefined;
	private placeholderSizeKey: string | undefined;
	private stageMaskCache: { key: string; rows: boolean[][] } | undefined;
	private observedFullRedraws = 0;
	private disposed = false;
	private readonly columns: number;
	private readonly rows: number;
	private readonly stageRows: number;
	private readonly borderLine: number;
	private readonly inset: number;

	constructor(
		private readonly getState: () => ClawdState,
		private readonly getTheme: () => Theme,
		private readonly terminalRows: () => number,
		private readonly options: PortraitOptions = {},
	) {
		this.columns = options.columns ?? CLAWD_COLUMNS;
		this.rows = options.rows ?? CLAWD_ROWS;
		this.stageRows = Math.max(this.rows, Math.floor(options.stageRows ?? this.rows));
		this.borderLine = options.borderRow ?? this.stageRows - this.rows - 1;
		this.inset = options.inset ?? 0;
	}

	invalidate(): void {
		this.cachedTheme = undefined;
		this.cells.clear();
		// PNG colors are immutable. Do not retransmit an unchanged image on every
		// streaming/theme invalidation; only pose, cell size or width changes matter.
	}

	dispose(): void {
		this.disposed = true;
		this.images.clear();
		this.placeholderImages.clear();
	}

	/** Hidden placements may be discarded by a terminal redraw while not rendered. */
	resetUpload(): void {
		this.placeholderUploadedKey = undefined;
		this.placeholderRenderedKey = undefined;
	}

	render(width: number): string[] {
		const state = this.getState();
		const minWidth = Math.max(MIN_COLUMNS, this.columns + this.inset + 1);
		if (!state.enabled || !Number.isFinite(width) || width < minWidth || this.terminalRows() < MIN_ROWS) {
			this.lastImagePose = undefined;
			return [];
		}
		width = Math.floor(width);
		const cell = getCellDimensions();
		const validCell = [cell.widthPx, cell.heightPx].every(size => Number.isFinite(size) && size >= 1 && size <= 1024);
		if (this.options.mode !== "text" && getCapabilities().images === "kitty" && validCell) {
			return this.renderImage(width, portraitFrame(state), cell.widthPx, cell.heightPx);
		}
		this.lastImagePose = undefined;
		return this.renderText(width, portraitFrame(state));
	}

	/** A footer glyph area: no outer padding and never an extra text row. */
	renderGlyph(): string[] {
		const state = this.getState();
		if (!state.enabled || this.disposed) {
			this.placeholderUploadedKey = undefined;
			this.placeholderRenderedKey = undefined;
			return [];
		}
		const cell = getCellDimensions();
		const validCell = [cell.widthPx, cell.heightPx].every(size => Number.isFinite(size) && size >= 1 && size <= 1024);
		if (this.options.mode === "text" || getCapabilities().images !== "kitty" || !validCell) return [];
		if (this.options.placeholders) return this.renderPlaceholders(portraitFrame(state), cell.widthPx, cell.heightPx);
		// Image reserves two horizontal cells for its own margin. Compensate once
		// so an eight-column, two-row footer glyph is really c=8, r=2.
		return this.renderImage(this.columns + 2, portraitFrame(state), cell.widthPx, cell.heightPx)
			.map(line => line.slice(2));
	}

	/**
	 * Unicode placeholder cells are ordinary selectable text. Uploading separately
	 * keeps APC image data out of Pi's screen lines: text-only footer updates then
	 * cause no Kitty placement deletion, and both rows retain selection highlight.
	 */
	private renderPlaceholders(frame: PortraitFrame, cellWidth: number, cellHeight: number): string[] {
		this.preparePlaceholders(frame, cellWidth, cellHeight);
		const foreground = this.placeholderForeground();
		const first = this.stageRows - this.rows;
		return Array.from({ length: this.rows }, (_, index) => {
			const row = first + index;
			let cells = "";
			for (let column = 0; column < this.columns; column++) {
				cells += KITTY_PLACEHOLDER + ROW_COLUMN_DIACRITICS[row] + ROW_COLUMN_DIACRITICS[column];
			}
			return foreground + cells + "\x1b[39m";
		});
	}

	/**
	 * Lines above the footer, rendered by a non-capturing overlay over the editor's
	 * blank right margin. Only cells with actual pixels become placeholders, so the
	 * editor's border is redrawn by `fill` everywhere the sprite is transparent.
	 * Returns only the lines the current frame needs, keeping its bottom edge on the
	 * footer; the caller must anchor them to the bottom.
	 */
	renderStageTop(fill: (stageRow: number) => string): string[] {
		const count = this.stageTopRows();
		if (count <= 0) return [];
		const cell = getCellDimensions();
		const state = this.getState();
		const frame = portraitFrame(state);
		this.preparePlaceholders(frame, cell.widthPx, cell.heightPx);
		const mask = this.stageMask(frame, cell.widthPx, cell.heightPx);
		const first = Math.min(OVERLAY_ROWS, this.stageRows - this.rows) - count;
		const foreground = this.placeholderForeground();
		return Array.from({ length: count }, (_, index) => this.stageLine(mask, first + index, foreground, fill));
	}

	/**
	 * Both glyph rows for an overlay placed inside the editor's own lines. Unlike
	 * `renderStageTop`, rows are never trimmed: the whole rectangle belongs to the
	 * sprite, the border row is repainted where transparent, and callers hide it
	 * entirely when the prompt text reaches those columns.
	 */
	renderInline(fill: (stageRow: number) => string): string[] {
		const state = this.getState();
		if (!state.enabled || this.disposed || !this.options.placeholders) return [];
		const cell = getCellDimensions();
		if (![cell.widthPx, cell.heightPx].every(size => Number.isFinite(size) && size >= 1 && size <= 1024)) return [];
		if (getCapabilities().images !== "kitty") return [];
		const frame = portraitFrame(state);
		this.preparePlaceholders(frame, cell.widthPx, cell.heightPx);
		const mask = this.stageMask(frame, cell.widthPx, cell.heightPx);
		const first = this.stageRows - this.rows;
		const foreground = this.placeholderForeground();
		return Array.from({ length: this.rows }, (_, index) => this.stageLine(mask, first + index, foreground, fill));
	}

	/** Stage row that carries the editor's bottom border, or -1 when there is none. */
	borderRow(): number {
		return this.borderLine;
	}

	private stageLine(mask: boolean[][], row: number, foreground: string, fill: (stageRow: number) => string): string {
		let line = "";
		for (let column = 0; column < this.columns; column++) {
			line += mask[row]?.[column]
				? foreground + KITTY_PLACEHOLDER + ROW_COLUMN_DIACRITICS[row] + ROW_COLUMN_DIACRITICS[column] + "\x1b[39m"
				: fill(row);
		}
		return line;
	}

	/** How many stage lines above the footer this frame needs (0 means no overlay). */
	stageTopRows(): number {
		const state = this.getState();
		const available = Math.min(OVERLAY_ROWS, this.stageRows - this.rows);
		if (!state.enabled || this.disposed || !this.options.placeholders || available <= 0) return 0;
		const cell = getCellDimensions();
		if (![cell.widthPx, cell.heightPx].every(size => Number.isFinite(size) && size >= 1 && size <= 1024)) return 0;
		if (getCapabilities().images !== "kitty") return 0;
		const mask = this.stageMask(portraitFrame(state), cell.widthPx, cell.heightPx);
		for (let row = 0; row < available; row++) if (mask[row].some(Boolean)) return available - row;
		return 0;
	}

	/** Whether the current clip should keep an overlay mounted at all. */
	stageActive(): boolean {
		const state = this.getState();
		if (!state.enabled || this.disposed || !this.options.placeholders || this.stageRows <= this.rows) return false;
		const cell = getCellDimensions();
		if (![cell.widthPx, cell.heightPx].every(size => Number.isFinite(size) && size >= 1 && size <= 1024)) return false;
		if (getCapabilities().images !== "kitty") return false;
		return portraitFrame(state).height > FOOTER_MAX_CANVAS_ROWS;
	}

	private preparePlaceholders(frame: PortraitFrame, cellWidth: number, cellHeight: number): void {
		const transport = this.options.placeholders!;
		const geometry = this.placeholderGeometry(frame, cellWidth, cellHeight);
		const sizeKey = String(this.columns) + "/" + String(this.stageRows) + "/" + String(cellWidth) + "/" + String(cellHeight);
		if (this.placeholderSizeKey !== sizeKey) {
			this.placeholderImages.clear();
			this.lastImagePose = undefined;
			this.placeholderUploadedKey = undefined;
			this.placeholderSizeKey = sizeKey;
		}
		this.placeholderId ??= allocateImageId() % 0xffffff + 1; // 24-bit foreground colour carries the id.
		let png = this.placeholderImages.get(frame.key);
		if (!png) {
			png = encodeRgbaPng(frame.pixels, geometry.widthPx, geometry.heightPx, geometry.maxScale).toString("base64");
			this.placeholderImages.set(frame.key, png);
			// Bound the cache: the full catalogue has over a thousand frames and
			// only recently played ones are worth keeping.
			if (this.placeholderImages.size > 256) {
				const oldest = this.placeholderImages.keys().next().value;
				if (oldest !== undefined) this.placeholderImages.delete(oldest);
			}
		}
		const key = sizeKey + "/" + frame.key;
		this.placeholderRenderedKey = key;
		this.uploadPlaceholder(transport, key, png);

		// A full Pi redraw clears all uploaded images after components render.
		// Restore only in that case, after terminal.write() has emitted the frame.
		const redraws = transport.fullRedraws();
		this.observedFullRedraws = redraws;
		queueMicrotask(() => {
			if (this.disposed || this.placeholderRenderedKey !== key) return;
			const current = transport.fullRedraws();
			if (current === this.observedFullRedraws) return;
			this.observedFullRedraws = current;
			this.uploadPlaceholder(transport, key, png!, true);
		});
	}

	/** Pixel box and scale for the whole stage, shared by PNG encoding and cell masking. */
	private placeholderGeometry(frame: PortraitFrame, cellWidth: number, cellHeight: number): { widthPx: number; heightPx: number; cellWidth: number; cellHeight: number; maxScale: number } {
		const boxWidth = this.columns * cellWidth;
		const boxHeight = this.stageRows * cellHeight;
		const limit = Math.min(1, 1024 / Math.max(boxWidth, boxHeight));
		const widthPx = Math.max(1, Math.round(boxWidth * limit));
		const heightPx = Math.max(1, Math.round(boxHeight * limit));
		// The original fifteen canvases keep exactly today's footer framing. Only
		// taller clips may grow into the stage, bounded by the canonical body size.
		const footerFit = Math.min((this.columns * cellWidth) / frame.width, (this.rows * cellHeight) / frame.height);
		const bodyScale = Math.min((this.columns * cellWidth) / SOURCE_COLUMNS, (this.rows * cellHeight) / SOURCE_ROWS);
		const maxScale = (frame.height <= FOOTER_MAX_CANVAS_ROWS ? footerFit : bodyScale) * limit;
		return { widthPx, heightPx, cellWidth: widthPx / this.columns, cellHeight: heightPx / this.stageRows, maxScale };
	}

	/** Stage cell occupancy for the current frame, in stage-row order. */
	private stageMask(frame: PortraitFrame, cellWidth: number, cellHeight: number): boolean[][] {
		const geometry = this.placeholderGeometry(frame, cellWidth, cellHeight);
		const key = String(geometry.widthPx) + "x" + String(geometry.heightPx) + "/" + frame.key;
		if (this.stageMaskCache?.key === key) return this.stageMaskCache.rows;
		const rows = Array.from({ length: this.stageRows }, () => Array<boolean>(this.columns).fill(false));
		const { scale, left, top } = fitRgba(frame.width, frame.height, geometry.widthPx, geometry.heightPx, geometry.maxScale);
		// The row directly above the footer holds the editor's bottom border. Only a
		// sprite pixel actually crossing that glyph may replace the cell; otherwise a
		// stray confetti bit would erase a whole border segment.
		const borderRow = this.borderLine;
		const borderLine = borderRow >= 0 && borderRow < this.stageRows
			? Math.floor(borderRow * geometry.cellHeight + geometry.cellHeight / 2)
			: -1;
		for (let y = 0; y < geometry.heightPx; y++) {
			const sourceY = Math.floor((y + 0.5 - top) / scale);
			if (sourceY < 0 || sourceY >= frame.height) continue;
			const rowIndex = Math.min(this.stageRows - 1, Math.floor(y / geometry.cellHeight));
			if (rowIndex === borderRow && y !== borderLine) continue;
			const row = rows[rowIndex];
			for (let x = 0; x < geometry.widthPx; x++) {
				const sourceX = Math.floor((x + 0.5 - left) / scale);
				if (sourceX < 0 || sourceX >= frame.width || frame.pixels[sourceY][sourceX] === null) continue;
				row[Math.min(this.columns - 1, Math.floor(x / geometry.cellWidth))] = true;
			}
		}
		this.stageMaskCache = { key, rows };
		return rows;
	}

	private placeholderForeground(): string {
		const id = this.placeholderId ?? 1;
		return `\x1b[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;
	}

	private uploadPlaceholder(transport: KittyPlaceholderTransport, key: string, png: string, force = false): void {
		if (!force && this.placeholderUploadedKey === key) return;
		const sequence = encodeKitty(png, {
			columns: this.columns, rows: this.stageRows, imageId: this.placeholderId, moveCursor: false,
		}).replace("a=T", "a=T,U=1");
		transport.write(sequence);
		this.placeholderUploadedKey = key;
	}

	private renderImage(width: number, frame: PortraitFrame, cellWidth: number, cellHeight: number): string[] {
		const sizeKey = String(this.columns) + "/" + String(this.rows) + "/" + String(cellWidth) + "/" + String(cellHeight);
		if (this.imageSizeKey !== sizeKey) {
			this.images.clear();
			this.lastImagePose = undefined;
			this.imageSizeKey = sizeKey;
		}
		let image = this.images.get(frame.key);
		if (!image) {
			const boxWidth = this.columns * cellWidth;
			const boxHeight = this.rows * cellHeight;
			const limit = Math.min(1, 1024 / Math.max(boxWidth, boxHeight));
			const widthPx = Math.max(1, Math.round(boxWidth * limit));
			const heightPx = Math.max(1, Math.round(boxHeight * limit));
			const png = encodeRgbaPng(frame.pixels, widthPx, heightPx);
			this.imageId ??= allocateImageId();
			image = new Image(png.toString("base64"), "image/png", {
				fallbackColor: text => this.getTheme().fg("dim", text),
			}, { maxWidthCells: this.columns, maxHeightCells: this.rows, imageId: this.imageId }, { widthPx, heightPx });
			this.images.set(frame.key, image);
		}
		if (this.lastImagePose !== frame.key) {
			// All poses share one Kitty ID. Re-register cached poses when switching
			// back so fullscreen replaces the data instead of retaining the last pose.
			image.invalidate();
			this.lastImagePose = frame.key;
		}
		const lines = image.render(width);
		const left = " ".repeat(width - this.columns - this.inset);
		const reserved = " ".repeat(this.columns + this.inset);
		// Pi reserves continuation rows only when they are genuinely empty.
		return Array.from({ length: this.rows }, (_, row) => row === 0 ? left + (lines[0] ?? "") + reserved : "");
	}

	private renderText(width: number, frame: PortraitFrame): string[] {
		const theme = this.getTheme();
		if (this.cachedTheme !== theme) {
			this.cells.clear();
			this.cachedTheme = theme;
		}
		const columns = Math.ceil(frame.width / 2);
		const left = " ".repeat(Math.max(0, width - columns - this.inset));
		const right = " ".repeat(this.inset);
		const lines: string[] = [];
		// Four rows is the fixed text-widget budget. Resample taller official
		// canvases instead of moving the editor between four and five rows.
		for (let row = 0; row < TEXT_ROWS; row++) {
			const topY = Math.floor((row * 2 * frame.height) / (TEXT_ROWS * 2));
			const bottomY = Math.floor(((row * 2 + 1) * frame.height) / (TEXT_ROWS * 2));
			let line = left;
			for (let x = 0; x < frame.width; x += 2) {
				line += this.cell(theme, frame.pixels[topY]?.[x] ?? null, frame.pixels[bottomY]?.[x] ?? null);
			}
			lines.push(line + right);
		}
		return lines;
	}

	private cell(theme: Theme, top: Rgba | null, bottom: Rgba | null): string {
		if (top === null && bottom === null) return " ";
		const topKey = top?.join(",");
		const bottomKey = bottom?.join(",");
		const key = String(topKey) + "/" + String(bottomKey);
		const cached = this.cells.get(key);
		if (cached !== undefined) return cached;
		const topColor = top ? rgbColor(top[0], top[1], top[2]) : undefined;
		const bottomColor = bottom ? rgbColor(bottom[0], bottom[1], bottom[2]) : undefined;
		let cell: string;
		if (top === null) cell = theme.style("▄", { fg: bottomColor! });
		else if (bottom === null) cell = theme.style("▀", { fg: topColor! });
		else if (topKey === bottomKey) cell = theme.style("█", { fg: topColor! });
		else cell = theme.style("▀", { fg: topColor!, bg: bottomColor! });
		this.cells.set(key, cell);
		return cell;
	}
}
