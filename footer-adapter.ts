import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, stripTerminalSequences, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ClawdAnimation } from "./animation.ts";
import {
	hasFooterPlaceholder,
	CLAWD_COLUMNS,
	CLAWD_ROWS,
	ClawdPortrait,
	combineGlyphs,
	FALLBACK_COLUMNS,
	FALLBACK_ROWS,
	MIN_COLUMNS,
	MIN_ROWS,
	MINI_COLUMNS,
	MINI_ROWS,
	OVERLAY_ROWS,
	STAGE_ROWS,
} from "./sprite.ts";

export const CLAWD_FOOTER_KEY = "pi-cc-clawd";
/** Private-use marker, replaced before any compatible footer reaches the terminal. */
export const CLAWD_PLACEHOLDER = "\ue000";
export type FooterFactory = NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]>;

/** Anything that can draw the footer's placeholder block. */
export interface GlyphSource {
	renderGlyph(): string[];
}

/** Remove only our marker and a separator actually adjacent to it. */
export function removeFooterMarker(line: string): string {
	const at = line.indexOf(CLAWD_PLACEHOLDER);
	if (at < 0) return line;
	const before = line.slice(0, at);
	const after = line.slice(at + CLAWD_PLACEHOLDER.length);
	const separator = before.lastIndexOf(" · ");
	if (separator >= 0 && stripTerminalSequences(before.slice(separator + 3)).trim() === "") {
		return before.slice(0, separator) + before.slice(separator + 3) + after;
	}
	// The marker can be the first chip after indentation/ANSI styling. In that
	// case the separator on its right becomes dangling and must be removed too.
	if (stripTerminalSequences(before).trim() === "" && after.startsWith(" · ")) return before + after.slice(3);
	return before + after;
}

/**
 * Keep one column clear after the glyph. Some terminals mishandle the last
 * cell's grapheme cluster: a placeholder written flush into the bottom-right
 * corner loses its row/column diacritics, which clips the sprite's right edge.
 */
export const GLYPH_RIGHT_MARGIN = 1;

/**
 * The standalone glyph sits in the native footer's middle, where the right-aligned
 * model label can reach on narrow terminals. Below this width it stays hidden
 * rather than covering footer text.
 */
export const STANDALONE_MIN_COLUMNS = 110;

/** Preserve footer text, but use the actual image's physical width for right alignment. */
export function rightAlignGlyph(line: string, glyph: string, width: number): string {
	if (width < CLAWD_COLUMNS + GLYPH_RIGHT_MARGIN + 1) return truncateToWidth(line, width);
	const text = truncateToWidth(line, Math.max(0, width - CLAWD_COLUMNS - GLYPH_RIGHT_MARGIN - 1));
	const padding = " ".repeat(Math.max(0, width - CLAWD_COLUMNS - visibleWidth(text) - GLYPH_RIGHT_MARGIN));
	return text + padding + glyph + " ".repeat(GLYPH_RIGHT_MARGIN);
}

/**
 * Decorate a captured footer, never replace its model/usage/git rendering. Only
 * line two may contain the marker: native footer puts extension statuses on line
 * three, so it is intentionally not treated as a compatible two-line footer.
 */
export function decorateFooter<T extends Component>(
	base: T,
	portrait: GlyphSource,
	onIncompatible?: () => void,
	onClick?: (clickCount: number) => void,
): T {
	const bound = new Map<PropertyKey, { original: Function; value: Function }>();
	let lastWidth = 0;
	return new Proxy(base, {
		get(target, key, receiver) {
			if (key === "handleMouse" && onClick) {
				return (event: TuiMouseEvent) => {
					if (event.button === "left" && lastWidth > 0 && (event.y === 0 || event.y === 1) && portrait.renderGlyph().length === 2) {
						const start = lastWidth - CLAWD_COLUMNS - GLYPH_RIGHT_MARGIN;
						if (event.x >= start && event.x < lastWidth - GLYPH_RIGHT_MARGIN) {
							// Press must be handled to claim the gesture; the click then acts.
							if (event.type === "press") return { handled: true, render: false } as const;
							if (event.type === "click") {
								onClick?.(event.clickCount ?? 1);
								return { handled: true, render: false } as const;
							}
						}
					}
					const baseHandler = Reflect.get(target, "handleMouse", receiver);
					return typeof baseHandler === "function" ? baseHandler.call(target, event) : undefined;
				};
			}
			if (key === "render") return (width: number) => {
				lastWidth = width;
				const rendered = base.render(width);
				if (rendered.length < 2 || !rendered[1].includes(CLAWD_PLACEHOLDER)) {
					onIncompatible?.();
					return rendered.map(line => line.includes(CLAWD_PLACEHOLDER) ? removeFooterMarker(line) : line);
				}
				const lines = rendered.map(line => line.includes(CLAWD_PLACEHOLDER) ? removeFooterMarker(line) : line);
				const cleaned = lines[1];
				const glyph = portrait.renderGlyph();
				if (glyph.length === 2) {
					// One image spans the rightmost columns of BOTH existing rows. Each
					// row carries selectable placeholder cells, never another image upload.
					return [rightAlignGlyph(lines[0], glyph[0], width), rightAlignGlyph(cleaned, glyph[1], width), ...lines.slice(2)];
				}
				return [lines[0], glyph.length === 1 ? rightAlignGlyph(cleaned, glyph[0], width) : truncateToWidth(cleaned, width), ...lines.slice(2)];
			};
			const value = Reflect.get(target, key, receiver);
			if (typeof value !== "function" || key === "constructor" || Object.hasOwn(target, key)) return value;
			const previous = bound.get(key);
			if (previous && previous.original === value) return previous.value;
			const method = value.bind(target);
			bound.set(key, { original: value, value: method });
			return method;
		},
		set(target, key, value) { return Reflect.set(target, key, value, target); },
	});
}

/**
 * Non-capturing stage above the footer. Pi composites overlays into the screen
 * lines, so the two rows over the editor's blank right margin can hold the taller
 * official canvases without adding footer rows. Cells the sprite does not cover
 * are painted with the editor's own bottom border, so the box never shows a gap.
 */
export class ClawdOverlay implements Component {
	constructor(
		private readonly getPortrait: () => ClawdPortrait | undefined,
		private readonly getTheme: () => ExtensionContext["ui"]["theme"],
		/** "inline" draws an untrimmed glyph, used for the standalone footer center. */
		private readonly mode: "stage" | "inline" = "stage",
		private readonly onClick?: (clickCount: number) => void,
	) {}

	invalidate(): void {}

	handleMouse(event: TuiMouseEvent): { handled: true; render: false } | undefined {
		if (event.button !== "left") return undefined;
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		this.onClick?.(event.clickCount ?? 1);
		return { handled: true, render: false };
	}

	render(width: number): string[] {
		if (!Number.isFinite(width) || width < 1) return [];
		const portrait = this.getPortrait();
		if (!portrait) return [];
		const theme = this.getTheme();
		const borderRow = portrait.borderRow();
		const border = theme.fg("borderMuted", "─");
		const fill = (row: number) => row === borderRow ? border : " ";
		return this.mode === "inline" ? portrait.renderInline(fill) : portrait.renderStageTop(fill);
	}
}

/**
 * The footer face: one 8x2 Clawd, or two 4x2 companions while parallel tools run.
 * Both minis are separate Kitty images with their own ids, so they tile cleanly.
 */
export class ClawdFooterFace implements GlyphSource {
	private left: ClawdPortrait | undefined;
	private right: ClawdPortrait | undefined;
	private showingMinis = false;

	constructor(
		private readonly animation: ClawdAnimation,
		private readonly single: ClawdPortrait,
		private readonly makeMini: (slot: 0 | 1) => ClawdPortrait,
	) {}

	renderGlyph(): string[] {
		const minis = this.animation.getState().minis?.length === 2;
		if (minis !== this.showingMinis) {
			// A full redraw may have discarded the other mode's uploads.
			this.showingMinis = minis;
			this.single.resetUpload();
			this.left?.resetUpload();
			this.right?.resetUpload();
		}
		if (!minis) return this.single.renderGlyph();
		this.left ??= this.makeMini(0);
		this.right ??= this.makeMini(1);
		return combineGlyphs(this.left.renderGlyph(), this.right.renderGlyph());
	}

	resetUpload(): void {
		this.single.resetUpload();
		this.left?.resetUpload();
		this.right?.resetUpload();
	}

	/** The caller owns `single`; only the minis created here are disposed. */
	dispose(): void {
		this.left?.dispose();
		this.right?.dispose();
		this.left = undefined;
		this.right = undefined;
	}
}

/** Optional renderer integration with a native below-editor fallback. */
export class FooterPlacement {
	private readonly originalSetFooter: ExtensionContext["ui"]["setFooter"];
	private portrait: ClawdPortrait | undefined;
	private portraitKind: "footer" | "widget" | "inline" | undefined;
	private view: Component | undefined;
	private requestRender: (() => void) | undefined;
	private inlineComponent: Component | undefined;
	private inlineTui: TUI | undefined;
	private inlineHandle: { hide(): void } | undefined;
	private inlinePortrait: ClawdPortrait | undefined;
	private capturedFooter = false;
	private mounted: "footer" | "widget" | undefined;
	private fallbackQueued = false;
	private disposed = false;
	private footerFace: ClawdFooterFace | undefined;
	private footerFacePortrait: ClawdPortrait | undefined;
	private overlayTui: TUI | undefined;
	private overlayComponent: ClawdOverlay | undefined;
	private overlayHandle: { hide(): void } | undefined;
	private overlayRow: number | undefined;
	private overlayHeight = 0;

	constructor(private readonly ctx: ExtensionContext, private readonly animation: ClawdAnimation) {
		this.originalSetFooter = ctx.ui.setFooter;
	}

	/** Run in session_start so a later custom footer factory can be captured. */
	prepare(): void {
		this.ctx.ui.setFooter = factory => {
			if (!factory) {
				this.capturedFooter = false;
				this.originalSetFooter(undefined);
				// A footer may be disabled while Pi is running. Do not leave our
				// private marker in the native footer's third status line.
				if (!this.disposed && this.mounted === "footer") this.mount("widget");
				return;
			}
			this.capturedFooter = true;
			this.originalSetFooter((tui, theme, data) => {
				if (this.disposed) return factory(tui, theme, data);
				const portrait = this.ensurePortrait(tui, "footer");
				const face = this.ensureFooterFace(tui, portrait);
				const base = factory(tui, theme, data);
				this.view = decorateFooter(base, face, () => {
					// Hiding Clawd intentionally removes the marker; that is not an
					// incompatible footer and must not trigger the widget fallback.
					if (this.animation.getState().enabled) this.queueWidgetFallback();
				}, count => void this.animation.poke(count));
				this.requestRender = () => tui.requestRender();
				this.mount("footer");
				return this.view;
			});
		};
	}

	/** Run after all startup handlers, once footer factories have had a chance to register. */
	mountDefault(): void {
		if (this.disposed) return;
		if (this.capturedFooter) this.mount("footer");
		else this.mount("widget");
	}

	refresh(): void {
		const enabled = this.animation.getState().enabled;
		if (!enabled) {
			if (this.footerFace) this.footerFace.resetUpload();
			else this.portrait?.resetUpload();
		}
		if (this.mounted === "footer") this.ctx.ui.setStatus(CLAWD_FOOTER_KEY, enabled ? CLAWD_PLACEHOLDER : undefined);
		this.view?.invalidate();
		this.startInlineOverlay();
		this.syncOverlay();
		// Also redraw on hide, removing the last placeholder cells from the footer.
		this.requestRender?.();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.hideOverlay();
		this.hideInlineOverlay();
		this.overlayTui = undefined;
		this.overlayComponent = undefined;
		this.inlineTui = undefined;
		this.inlineComponent = undefined;
		this.inlinePortrait = undefined;
		this.ctx.ui.setFooter = this.originalSetFooter;
		this.ctx.ui.setWidget(CLAWD_FOOTER_KEY, undefined);
		this.ctx.ui.setStatus(CLAWD_FOOTER_KEY, undefined);
		this.view = undefined;
		this.footerFace?.dispose();
		this.footerFace = undefined;
		this.footerFacePortrait = undefined;
		this.portrait?.dispose();
		this.portrait = undefined;
		this.portraitKind = undefined;
		this.requestRender = undefined;
		this.mounted = undefined;
	}

	private mount(kind: "footer" | "widget"): void {
		if (this.disposed || this.mounted === kind) return;
		this.mounted = kind;
		if (kind === "footer") {
			this.hideInlineOverlay();
			this.ctx.ui.setWidget(CLAWD_FOOTER_KEY, undefined);
			this.ctx.ui.setStatus(CLAWD_FOOTER_KEY, this.animation.getState().enabled ? CLAWD_PLACEHOLDER : undefined);
			return;
		}
		this.hideOverlay();
		this.hideInlineOverlay();
		this.ctx.ui.setStatus(CLAWD_FOOTER_KEY, undefined);
		this.ctx.ui.setWidget(CLAWD_FOOTER_KEY, (tui) => {
			if (typeof tui.showOverlay !== "function" || getCapabilities().images !== "kitty") {
				// No overlay support: keep the old below-editor widget instead.
				this.view = this.ensurePortrait(tui, "widget");
				this.requestRender = () => tui.requestRender();
				return this.view;
			}
			// A zero-line widget only captures the TUI handle: the sprite itself
			// lives in an overlay over the footer's empty middle, so no row is
			// reserved for it.
			this.inlineTui ??= tui;
			// The zero-line widget is the only place that captures this TUI; without
			// this, overlay frames would never ask Pi to redraw in standalone mode.
			this.requestRender = () => tui.requestRender();
			queueMicrotask(() => this.startInlineOverlay());
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
	}

	/**
	 * Standalone mode without a decoratable footer: place the same 8x2 glyph in a
	 * non-capturing overlay over the footer's empty middle. No layout row is
	 * reserved and the prompt editor is never touched.
	 */
	private startInlineOverlay(): void {
		const tui = this.inlineTui;
		if (this.disposed || this.mounted !== "widget" || !tui || typeof tui.showOverlay !== "function" || this.inlineHandle) return;
		const portrait = this.ensurePortrait(tui, "inline");
		this.inlinePortrait = portrait;
		this.inlineComponent ??= new ClawdOverlay(() => this.inlinePortrait, () => this.ctx.ui.theme, "inline", count => void this.animation.poke(count));
		try {
			this.inlineHandle = tui.showOverlay(this.inlineComponent, {
				anchor: "bottom-center",
				width: CLAWD_COLUMNS,
				maxHeight: CLAWD_ROWS,
				nonCapturing: true,
				visible: (width, height) => width >= STANDALONE_MIN_COLUMNS && height >= MIN_ROWS,
			});
		} catch {
			this.inlineTui = undefined;
		}
	}

	private hideInlineOverlay(): void {
		this.inlineHandle?.hide();
		this.inlineHandle = undefined;
	}

	private queueWidgetFallback(): void {
		if (this.disposed || this.fallbackQueued || this.mounted === "widget") return;
		this.fallbackQueued = true;
		queueMicrotask(() => {
			this.fallbackQueued = false;
			if (!this.disposed && this.mounted !== "widget") this.mount("widget");
		});
	}

	/**
	 * Keep the overlay only while the current frame actually paints above the
	 * footer. The overlay is removed between clips so Pi never composites (or
	 * pads) frames for an idle mascot.
	 */
	private syncOverlay(): void {
		const minis = this.animation.getState().minis?.length === 2;
		const active = this.disposed || this.mounted !== "footer" || minis ? false : this.portrait?.stageActive() ?? false;
		if (!active) {
			this.hideOverlay();
			return;
		}
		const count = this.portrait?.stageTopRows() ?? 0;
		if (count <= 0) {
			this.hideOverlay();
			return;
		}
		// Anchor to the footer's real row and skip the stage while the input line's
		// tail is not blank; a short session must not drop it below its own body.
		const placement = this.stagePlacement(count);
		if (!placement || !placement.clear) {
			this.hideOverlay();
			return;
		}
		const row = placement.row;
		if (this.overlayHandle && this.overlayRow === row && this.overlayHeight === count) return;
		this.hideOverlay();
		const tui = this.overlayTui;
		if (!tui || typeof tui.showOverlay !== "function") return;
		this.overlayComponent ??= new ClawdOverlay(() => this.portrait, () => this.ctx.ui.theme, "stage", count => void this.animation.poke(count));
		try {
			this.overlayHandle = tui.showOverlay(this.overlayComponent, {
				anchor: "bottom-right",
				row,
				width: CLAWD_COLUMNS,
				maxHeight: OVERLAY_ROWS,
				margin: { right: GLYPH_RIGHT_MARGIN },
				nonCapturing: true,
				visible: (width, height) => width >= MIN_COLUMNS && height >= MIN_ROWS,
			});
			this.overlayRow = row;
			this.overlayHeight = count;
		} catch {
			// A renderer without overlay support simply keeps the footer-only glyph.
			this.overlayTui = undefined;
		}
	}

	/**
	 * Width of the real input text, ignoring this stage's own placeholders and
	 * counting a reverse-video cursor cell as occupied.
	 */
	private inputLineWidth(line: string): number {
		const withCursor = line.replace(/\x1b\[7m([\s\S]*?)\x1b\[27m/g, (_, inner: string) => "X".repeat(visibleWidth(stripTerminalSequences(inner))));
		const withoutPlaceholders = stripTerminalSequences(withCursor).replace(/\u{10eeee}[\p{M}]+/gu, "");
		return visibleWidth(withoutPlaceholders.replace(/\s+$/, ""));
	}

	/**
	 * Where the stage goes, bottom-aligned to the footer, and whether the input
	 * line's glyph columns are free. Uses the previous screen snapshot so wrapped
	 * prompts, editor padding and a clipped footer all match what is really drawn.
	 */
	private stagePlacement(count: number): { row: number; clear: boolean } | undefined {
		const tui = this.overlayTui as unknown as {
			terminal?: { rows?: number; columns?: number };
			getScreenLines?: () => string[];
			captureRenderState?: () => { previousLines?: string[] };
		} | undefined;
		const rows = tui?.terminal?.rows ?? 0;
		const columns = tui?.terminal?.columns ?? 0;
		if (!tui || !rows) return undefined;
		let lines: string[] | undefined;
		if (typeof tui.getScreenLines === "function") lines = tui.getScreenLines();
		else if (typeof tui.captureRenderState === "function") lines = tui.captureRenderState().previousLines;
		else return { row: Math.max(0, rows - CLAWD_ROWS - count), clear: true }; // no screen snapshots
		if (!lines?.length) return undefined;
		let footerBottom = -1;
		for (let row = 0; row < lines.length; row++) {
			if (hasFooterPlaceholder(lines[row]!)) footerBottom = row;
		}
		if (footerBottom < 0) {
				return undefined;
		}
		let footerRows = 1;
		while (footerBottom - footerRows >= 0 && hasFooterPlaceholder(lines[footerBottom - footerRows]!)) footerRows += 1;
		// The overlay row is viewport-relative; content taller than the screen is
		// scrolled, so subtract the viewport start before placing the stage.
		const viewport = Math.max(0, lines.length - rows);
		const footerTop = footerBottom - viewport - footerRows + 1;
		const row = footerTop - count;
		if (row < 0) return undefined;
		let clear = true;
		if (count >= OVERLAY_ROWS) {
			if (!columns) return undefined;
			clear = this.inputLineWidth(lines[viewport + row] ?? "") <= columns - CLAWD_COLUMNS - GLYPH_RIGHT_MARGIN;
		}
		return { row, clear };
	}

	private hideOverlay(): void {
		this.overlayHandle?.hide();
		this.overlayHandle = undefined;
		this.overlayRow = undefined;
		this.overlayHeight = 0;
	}

	private ensurePortrait(tui: TUI, kind: "footer" | "widget" | "inline"): ClawdPortrait {
		if (!this.portrait || this.portraitKind !== kind) {
			this.hideOverlay();
			this.overlayComponent = undefined;
			this.footerFace?.dispose();
			this.footerFace = undefined;
			this.footerFacePortrait = undefined;
			this.portrait?.dispose();
			const placeholders = { write: (data: string) => tui.terminal.write(data), fullRedraws: () => tui.fullRedraws };
			this.portrait = new ClawdPortrait(
				() => this.animation.getState(), () => this.ctx.ui.theme, () => tui.terminal.rows,
				kind === "widget"
					? { columns: FALLBACK_COLUMNS, rows: FALLBACK_ROWS }
					: kind === "inline"
						? { columns: CLAWD_COLUMNS, rows: CLAWD_ROWS, stageRows: CLAWD_ROWS, borderRow: -1, placeholders }
						: { placeholders, stageRows: STAGE_ROWS },
			);
			this.portraitKind = kind;
		}
		if (kind === "footer") this.overlayTui = tui;
		if (kind === "inline") this.inlinePortrait = this.portrait;
		return this.portrait;
	}

	private ensureFooterFace(tui: TUI, portrait: ClawdPortrait): ClawdFooterFace {
		if (!this.footerFace || this.footerFacePortrait !== portrait) {
			this.footerFace?.dispose();
			this.footerFace = new ClawdFooterFace(this.animation, portrait, slot => this.makeMini(tui, slot));
			this.footerFacePortrait = portrait;
		}
		return this.footerFace;
	}

	/** A half-width companion reads the matching entry of the animation's minis. */
	private makeMini(tui: TUI, slot: 0 | 1): ClawdPortrait {
		const placeholders = { write: (data: string) => tui.terminal.write(data), fullRedraws: () => tui.fullRedraws };
		return new ClawdPortrait(
			() => {
				const state = this.animation.getState();
				const mini = state.minis?.[slot];
				return mini
					? { ...state, clip: { name: mini.name, frame: mini.frame }, minis: undefined }
					: { ...state, enabled: false, clip: undefined, minis: undefined };
			},
			() => this.ctx.ui.theme,
			() => tui.terminal.rows,
			{ columns: MINI_COLUMNS, rows: MINI_ROWS, stageRows: MINI_ROWS, borderRow: -1, placeholders },
		);
	}
}
