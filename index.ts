import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ClawdAnimation, type Schedule } from "./animation.ts";
import { FooterPlacement } from "./footer-adapter.ts";
import { OFFICIAL_SPRITE_NAMES } from "./official-sprites.ts";
import { PREFERENCES_ENTRY, readPreferences } from "./preferences.ts";

export interface ClawdExtensionOptions {
	schedule?: Schedule;
	random?: () => number;
}

/** Export the factory for lifecycle tests without a terminal or a model request. */
export function createClawdExtension(options: ClawdExtensionOptions = {}) {
	return function clawdExtension(pi: ExtensionAPI): void {
		let animation: ClawdAnimation | undefined;
		let placement: FooterPlacement | undefined;
		let mountedAnimation: ClawdAnimation | undefined;

		const dispose = (): void => {
			animation?.dispose();
			placement?.dispose();
			animation = undefined;
			placement = undefined;
			mountedAnimation = undefined;
		};

		pi.registerShortcut("ctrl+alt+c", {
			description: "Pet Clawd",
			handler: () => { animation?.pet(); },
		});

		pi.on("session_start", (_event, ctx) => {
			dispose();
			if (ctx.mode !== "tui") return;
			const next = new ClawdAnimation(() => placement?.refresh(), options.schedule, options.random, {
				contextPercent: () => {
					try {
						return ctx.getContextUsage()?.percent ?? null;
					} catch {
						return null;
					}
				},
			});
			next.setPreferences(readPreferences(ctx.sessionManager.getBranch()));
			animation = next;
			// Capture only a later custom footer factory. pi-cc-clawd must precede
			// pi-cc-extensions for this native integration; otherwise we use a widget.
			placement = new FooterPlacement(ctx, next);
			placement.prepare();
		});

		// All session_start handlers have finished: integrate without rebuilding
		// the prompt editor or replacing another extension's footer factory.
		pi.on("resources_discover", (_event, ctx) => {
			const next = animation;
			if (ctx.mode !== "tui" || !next || !placement || mountedAnimation === next) return;
			placement.mountDefault();
			mountedAnimation = next;
			next.start();
		});

		pi.on("agent_start", () => animation?.agentStart());
		pi.on("agent_settled", event => {
			animation?.refreshContext();
			animation?.agentSettled(event.aborted);
		});
		pi.on("tool_execution_start", event => animation?.toolStart(event.toolCallId, event.toolName));
		pi.on("tool_execution_end", event => animation?.toolEnd(event.toolCallId, event.isError));
		pi.on("input", event => animation?.userInput(event.text));
		pi.on("turn_end", event => {
			animation?.refreshContext();
			if (event.outcome === "error") animation?.turnError();
		});
		pi.on("session_before_compact", () => animation?.compactStart());
		pi.on("session_compact", event => animation?.compactEnd(event.willRetry));
		pi.on("session_compact_failed", event => animation?.compactFailed(event.aborted));

		pi.on("session_tree", (_event, ctx) => {
			if (ctx.mode === "tui") {
				animation?.setPreferences(readPreferences(ctx.sessionManager.getBranch()));
			}
		});
		pi.on("session_shutdown", dispose);

		pi.registerCommand("clawd", {
			description: "Control Clawd: on, off, pause, resume, blink, pet, or play an official animation",
			getArgumentCompletions: (prefix) => {
				if (prefix.startsWith("play ")) {
					const name = prefix.slice(5).trimStart().toLowerCase();
					const items = OFFICIAL_SPRITE_NAMES.filter(value => value.toLowerCase().startsWith(name));
					return items.length ? items.map(value => ({ value: "play " + value, label: value })) : null;
				}
				const items = ["on", "off", "pause", "resume", "blink", "pet", "play"].filter((value) => value.startsWith(prefix));
				return items.length ? items.map((value) => ({ value, label: value })) : null;
			},
			handler: async (args, ctx) => {
				if (ctx.mode !== "tui" || !animation) return;
				const state = animation.getState();
				const preferences = { enabled: state.enabled, motion: state.motion };
				const input = args.trim();
				if (input.startsWith("play")) {
					const requested = input.slice(4).trim();
					const name = OFFICIAL_SPRITE_NAMES.find(value => value.toLowerCase() === requested.toLowerCase());
					if (!name) {
						ctx.ui.notify("Usage: /clawd play <animation>; e.g. /clawd play DancingHappy", "info");
					} else if (!animation.playOfficial(name)) {
						ctx.ui.notify(animation.getState().enabled ? "Clawd is not ready yet; try again after startup." : "Enable Clawd before playing an animation.", "info");
					}
					return;
				}
				switch (input) {
					case "": preferences.enabled = !preferences.enabled; break;
					case "on": preferences.enabled = true; break;
					case "off": preferences.enabled = false; break;
					case "pause": preferences.motion = false; break;
					case "resume": preferences.motion = true; preferences.enabled = true; break;
					case "blink": animation.blink(); return;
					case "pet": if (!animation.pet()) ctx.ui.notify("Enable Clawd before petting it.", "info"); return;
					default:
						ctx.ui.notify("Usage: /clawd [on|off|pause|resume|blink|pet|play <animation>]", "info");
						return;
				}
				if (preferences.enabled === state.enabled && preferences.motion === state.motion) return;
				animation.setPreferences(preferences);
				// Custom entries are local preferences, not messages or model context.
				pi.appendEntry(PREFERENCES_ENTRY, preferences);
			},
		});
	};
}

export default createClawdExtension();
