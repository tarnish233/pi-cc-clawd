import { DEFAULT_PREFERENCES, type ClawdPreferences } from "./preferences.ts";
import {
	officialSpriteMetadata,
	type OfficialSpriteName,
} from "./official-sprites.ts";

export type ClawdPose = "standing" | "blink" | "look-left" | "look-right";
export type ClawdActivity =
	| "idle"
	| "working"
	| "tools"
	| "compacting"
	| "success"
	| "error"
	| "interrupted"
	| "sleeping";
export interface ClawdClip {
	name: OfficialSpriteName;
	frame: number;
}
export interface ClawdState extends ClawdPreferences {
	pose: ClawdPose;
	activity: ClawdActivity;
	clip?: ClawdClip;
}

/** Scheduling returns cancellation, making lifecycle tests independent of real time. */
export type Schedule = (callback: () => void, delayMs: number) => () => void;

export const scheduleTimeout: Schedule = (callback, delayMs) => {
	const timer = setTimeout(callback, delayMs);
	timer.unref();
	return () => clearTimeout(timer);
};

export interface ClawdAnimationOptions {
	/** Wall clock, injected by tests. */
	now?: () => number;
	/** Context window percent (0-100), supplied by the Pi session. */
	contextPercent?: () => number | null;
}

/** What a tool call looks like while it runs. */
export type ClawdToolGroup = "read" | "edit" | "shell" | "search" | "agent" | "ask" | "todo" | "magic" | "other";

/**
 * Tool calls borrow the official clips that already carry the right prop:
 * eyes scanning for reads, the laptop for edits, a run for a shell command,
 * a wave for a subagent, and so on. Taller canvases (laptop, wave, pointing,
 * thinking) borrow the stage for as long as the tool clip is held.
 */
export const TOOL_CLIPS: Readonly<Record<ClawdToolGroup, OfficialSpriteName>> = {
	read: "LookingAround",
	edit: "Laptop",
	shell: "Running",
	search: "LookingAroundEyesOnly",
	agent: "Waving",
	ask: "Pointing",
	todo: "Thinking",
	magic: "Spark",
	other: "CrabWalking",
};

const TOOL_GROUPS: ReadonlyMap<string, ClawdToolGroup> = new Map([
	["read", "read"], ["grep", "read"], ["find", "read"], ["ls", "read"], ["notebookread", "read"],
	["edit", "edit"], ["write", "edit"], ["multiedit", "edit"], ["notebookedit", "edit"],
	["bash", "shell"], ["powershell", "shell"], ["bashoutput", "shell"], ["killshell", "shell"],
	["web_search", "search"], ["websearch", "search"], ["fetch_content", "search"], ["webfetch", "search"],
	["agent", "agent"], ["task", "agent"], ["subagent", "agent"], ["sendmessage", "agent"],
	["ask_user_question", "ask"], ["askuserquestion", "ask"],
	["todo_write", "todo"], ["todowrite", "todo"],
]);

export function toolGroup(name: string): ClawdToolGroup {
	const key = name.toLowerCase();
	if (key.startsWith("mcp__")) return "magic";
	return TOOL_GROUPS.get(key) ?? "other";
}

interface LoopSpec {
	name: OfficialSpriteName;
	/** First frame shown when the clip starts. */
	start: number;
	/** Frame the loop returns to after `loopTo`. */
	loopFrom: number;
	loopTo: number;
}

function loopOf(name: OfficialSpriteName): LoopSpec {
	const last = officialSpriteMetadata(name).frameCount - 1;
	return { name, start: 0, loopFrom: 0, loopTo: last };
}

/** The working loop skips the intro and the settling tail of the 88-frame Desktop clip. */
const DESKTOP: LoopSpec = { name: "Desktop", start: 2, loopFrom: 15, loopTo: 75 };

/** Clips that can be shown inside the footer's two rows (no stage overlay). */
const FOOTER_IDLE_CLIPS: readonly [OfficialSpriteName, number][] = [
	["LookingAround", 6],
	["LookingAroundEyesOnly", 4],
	["Turning", 4],
	["Swaying", 4],
	["Walking", 3],
	["Excited", 3],
	["Hula", 2],
	["Dizzy", 1],
];

/** Taller idle flourishes; rare, and they borrow the stage for a moment. */
const STAGE_IDLE_CLIPS: readonly [OfficialSpriteName, number][] = [
	["Jumping", 2],
	["Waving", 2],
	["Lightbulb", 1],
	["Spark", 1],
	["Confetti", 1],
	["JumpingHappy", 1],
	["BreakDancing", 1],
];

/** Every clip appears once per bag: weighted repeats make the common ones frequent. */
const IDLE_CLIP_WEIGHT = [...FOOTER_IDLE_CLIPS, ...STAGE_IDLE_CLIPS].reduce((total, [, weight]) => total + weight, 0);

/**
 * Blinking is an ambient tic, not one of the idle acts: it runs on its own
 * 4-7 s clock and never competes with a clip for the same slot.
 */
const BLINK_MIN_MS = 4_000;
const BLINK_JITTER_MS = 3_000;
/** An idle act (look or clip) plays every 6-10 s, or 4-6 s when the context is crowded. */
const ACTION_MIN_MS = 6_000;
const ACTION_JITTER_MS = 4_000;
const CROWDED_ACTION_MIN_MS = 4_000;
const CROWDED_ACTION_JITTER_MS = 2_000;
/** Looks stay in the act pool, weighted low. */
const LOOK_WEIGHT = 3;

/** Community consensus: a tool clip must not flicker when tools finish in milliseconds. */
export const HOLD_FRAMES = 20; // 1.66s at 12 fps
/** The gap between two tool calls that still counts as one bout of work. */
export const TOOL_GAP_FRAMES = 4; // 0.33s
/** A turn this long changes the working loop to a tired sway. */
export const TIRED_MS = 120_000;
export const SLEEP_MS = 10 * 60_000;
export const NIGHT_SLEEP_MS = 3 * 60_000;
/** Tools in one turn before success ends with the confetti scene instead of a dance. */
export const MILESTONE_TOOLS = 12;
/** A tool-free turn faster than this ends with the happy hop instead of the dance. */
export const QUICK_TURN_MS = 15_000;
export const CROWDED_PERCENT = 85;

/** One cancellable timer drives idle delays, hold checks and 12 fps clip playback. */
export class ClawdAnimation {
	private preferences: ClawdPreferences = { ...DEFAULT_PREFERENCES };
	private pose: ClawdPose = "standing";
	private activity: ClawdActivity = "idle";
	private clip: ClawdClip | undefined;
	private clipOwner: "activity" | "manual" | undefined;
	/** True while the current clip is a one-shot; loops are safe places to defer an ending. */
	private clipOnce = false;
	/** Frames shown since the current clip started, used for the hold/gap rules. */
	private clipFrames = 0;
	private pending: { dueFrame: number; run: () => void } | undefined;
	private agentActive = false;
	private failed = false;
	private readonly tools = new Map<string, ClawdToolGroup>();
	private turnTools = 0;
	private turnStartedAt = 0;
	private idleSince = 0;
	private nextBlinkAt = 0;
	private nextActionAt = 0;
	private idleBag: OfficialSpriteName[] = [];
	private successes = 0;
	private context = 0;
	private crowdedShown = false;
	private readonly now: () => number;
	private readonly contextPercent: (() => number | null) | undefined;
	private started = false;
	private disposed = false;
	private cancelTimer: (() => void) | undefined;
	private generation = 0;

	constructor(
		private readonly changed: () => void,
		private readonly schedule: Schedule = scheduleTimeout,
		private readonly random: () => number = Math.random,
		options: ClawdAnimationOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.contextPercent = options.contextPercent;
	}

	getState(): ClawdState {
		return {
			...this.preferences,
			enabled: this.preferences.enabled && !this.disposed,
			pose: this.pose,
			activity: this.activity,
			...(this.clip ? { clip: { ...this.clip } } : {}),
		};
	}

	start(): void {
		if (this.started || this.disposed) return;
		this.started = true;
		this.refreshContext();
		this.wake();
		this.turnStartedAt = this.now();
		// The footer already paints its initial standing frame; do not redraw it twice.
		// A crowded-context reaction may already own the clip, so only queue when idle and still.
		if (this.activity === "idle" && !this.clip) this.queueIdle();
		else if (this.activity !== "idle") this.enterActivity(true);
	}

	setPreferences(preferences: ClawdPreferences): void {
		if (this.disposed) return;
		const wasMotion = this.preferences.motion;
		const wasEnabled = this.preferences.enabled;
		if (preferences.enabled === this.preferences.enabled && preferences.motion === this.preferences.motion) return;
		this.preferences = { ...preferences };
		this.wake();
		if (!this.preferences.enabled || !this.preferences.motion) {
			this.leaveClip();
			this.changed();
			return;
		}
		if (!wasMotion || !wasEnabled) this.enterActivity(true);
	}

	agentStart(): void {
		this.wake();
		this.agentActive = true;
		this.failed = false;
		this.tools.clear();
		this.turnTools = 0;
		this.turnStartedAt = this.now();
		this.activity = "working";
		this.enterActivity(true);
	}

	agentSettled(aborted: boolean): void {
		this.wake();
		const failed = this.failed;
		this.failed = false;
		this.agentActive = false;
		this.tools.clear();
		// The error one-shot is already playing; do not restart it or turn it into a success.
		if (failed && this.activity === "error" && this.clip?.name === "Facepalm" && this.clipOwner === "activity") return;
		this.activity = aborted ? "interrupted" : failed ? "error" : "success";
		if (this.activity === "success") this.successes += 1;
		this.enterActivity(true);
	}

	/** The tool name selects the clip; the id keeps parallel tools distinguishable. */
	toolStart(id: string, name = ""): void {
		this.wake();
		this.tools.set(id, toolGroup(name));
		this.turnTools += 1;
		this.activity = "tools";
		this.showTools(false);
	}

	toolEnd(id: string, isError: boolean): void {
		this.wake();
		this.tools.delete(id);
		if (isError) {
			this.activity = "error";
			this.enterActivity(true);
			return;
		}
		if (!this.agentActive) {
			this.activity = "idle";
			this.enterActivity(true);
			return;
		}
		if (this.tools.size) {
			this.activity = "tools";
			this.showTools(false);
			return;
		}
		this.queueWorkingAfterGap();
	}

	compactStart(): void {
		this.wake();
		this.activity = "compacting";
		this.enterActivity(true);
	}

	compactEnd(willRetry: boolean): void {
		this.wake();
		this.activity = willRetry || this.agentActive ? "working" : "success";
		this.enterActivity(true);
	}

	compactFailed(aborted: boolean): void {
		this.wake();
		this.activity = aborted ? this.resumeTarget() : "error";
		this.enterActivity(true);
	}

	turnError(): void {
		this.wake();
		this.failed = true;
		this.activity = "error";
		this.enterActivity(true);
	}

	/** A steer or follow-up prompt during a turn gets a hop; the idle prompt's hop would be lost. */
	userInput(text: string): void {
		if (!this.started || this.disposed || !this.preferences.enabled || !this.preferences.motion) return;
		if (text.trim().length === 0 || text.trimStart().startsWith("/")) return;
		if (!this.agentActive) return;
		this.wake();
		this.playOnce("Jumping", () => this.enterActivity(true));
	}

	/** A one-shot blink also works while autonomous motion is paused. */
	blink(): void {
		if (!this.started || this.disposed || !this.preferences.enabled) return;
		this.wake();
		this.playBuiltin("blink", 160);
	}

	/** Petting reacts with a happy one-shot, even while autonomous motion is paused. */
	pet(): boolean {
		return this.poke(1);
	}

	/** A click: one happy move, or a dizzy spin when clicked four times quickly. */
	poke(clickCount = 1): boolean {
		if (!this.started || this.disposed || !this.preferences.enabled) return false;
		this.wake();
		const clips: OfficialSpriteName[] = clickCount >= 4 ? ["Dizzy"] : ["Excited", "Hula", "Waving", "DancingHappy"];
		this.playOnce(this.pick(clips), () => this.enterActivity(true), "manual");
		return true;
	}

	/** Play any official clip once, including while paused. */
	playOfficial(name: OfficialSpriteName): boolean {
		if (!this.started || this.disposed || !this.preferences.enabled) return false;
		this.wake();
		this.playOnce(name, () => this.enterActivity(true), "manual");
		return true;
	}

	/** Re-read the context window; the session calls this after replies and turns. */
	refreshContext(): void {
		const percent = this.contextPercent?.();
		this.context = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent as number)) : 0;
		if (this.context < CROWDED_PERCENT) {
			this.crowdedShown = false;
			return;
		}
		if (this.crowdedShown) return;
		// React once per crossing; while a turn runs, the reaction waits for idle.
		if (this.activity === "idle") this.showCrowded();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearTimer();
	}

	private get ready(): boolean {
		return this.started && !this.disposed && this.preferences.enabled && this.preferences.motion;
	}

	private get crowded(): boolean {
		return this.context >= CROWDED_PERCENT;
	}

	private wake(): void {
		const now = this.now();
		this.idleSince = now;
		this.nextBlinkAt = now + BLINK_MIN_MS + Math.floor(this.random() * BLINK_JITTER_MS);
		this.nextActionAt = now + this.actionDelay();
		if (this.activity === "sleeping") this.activity = "idle";
	}

	private enterActivity(immediate: boolean): void {
		this.pending = undefined;
		if (!this.ready) {
			this.leaveClip();
			this.changed();
			return;
		}
		switch (this.activity) {
			case "working":
				this.switchTo(this.workingSpec(), immediate);
				break;
			case "tools":
				this.switchTo(this.toolsSpec(), immediate);
				break;
			case "compacting":
				this.switchTo(loopOf("Meditating"), immediate);
				break;
			case "success": {
				const name = this.successClip();
				const dance = () => this.playOnce(name, () => {
					this.activity = "idle";
					this.enterActivity(true);
				});
				// A quick final tool keeps its minimum hold before the dance starts.
				if (this.deferOneShot(dance)) break;
				dance();
				break;
			}
			case "error":
				this.playOnce("Facepalm", () => {
					this.activity = this.resumeTarget();
					this.enterActivity(true);
				});
				break;
			case "interrupted":
				this.playOnce("Disappointed", () => {
					this.activity = "idle";
					this.enterActivity(true);
				});
				break;
			case "sleeping":
				this.startLoop(loopOf("Meditating"), 4);
				break;
			case "idle":
				this.enterIdle();
				break;
		}
	}

	private enterIdle(): void {
		this.leaveClip();
		if (this.crowded && !this.crowdedShown) {
			this.showCrowded();
			return;
		}
		this.changed();
		this.queueIdle();
	}

	/** One dizzy reaction per crowded crossing, so it never turns into a tic. */
	private showCrowded(): void {
		// Leave the crossing pending while hidden or paused; enterIdle retries it.
		if (!this.ready) return;
		this.crowdedShown = true;
		this.playOnce("Dizzy", () => this.enterActivity(true));
	}

	private leaveClip(): void {
		this.clearTimer();
		this.clip = undefined;
		this.clipOwner = undefined;
		this.pending = undefined;
		this.pose = "standing";
	}

	/** Play a one-shot only after the current activity clip has had its hold. */
	private deferOneShot(run: () => void): boolean {
		if (this.turnTools === 0 || this.clipOnce || this.clipOwner !== "activity" || !this.clip || this.clipFrames >= HOLD_FRAMES) return false;
		this.pending = { dueFrame: HOLD_FRAMES, run };
		return true;
	}

	private resumeTarget(): ClawdActivity {
		return this.agentActive ? (this.tools.size ? "tools" : "working") : "idle";
	}

	private successClip(): OfficialSpriteName {
		if (this.turnTools >= MILESTONE_TOOLS) return "Confetti";
		if (this.successes % 10 === 0) return "BreakDancing";
		if (this.turnTools === 0 && this.now() - this.turnStartedAt < QUICK_TURN_MS) return "JumpingHappy";
		return "DancingHappy";
	}

	private workingSpec(): LoopSpec {
		return this.tired() ? loopOf("Swaying") : DESKTOP;
	}

	private tired(): boolean {
		return this.now() - this.turnStartedAt >= TIRED_MS;
	}

	private toolsSpec(): LoopSpec {
		const group = [...this.tools.values()].at(-1) ?? "other";
		return loopOf(TOOL_CLIPS[group]);
	}

	/**
	 * Keep the current clip until it has had its minimum screen time; the latest
	 * tool that arrives during the hold wins when the hold ends.
	 */
	private showTools(immediate: boolean): void {
		if (!this.ready) {
			this.leaveClip();
			this.changed();
			return;
		}
		const spec = this.toolsSpec();
		// A tool of the same family (or another one during the gap) keeps the running
		// loop; restarting it at frame 0 would look like a flicker.
		if (this.clip?.name === spec.name && this.clipOwner === "activity") {
			this.pending = undefined;
			return;
		}
		// Entering work is immediate; the hold only protects tool-to-tool switches.
		const holdingWorking = this.clip?.name === DESKTOP.name || this.clip?.name === "Swaying";
		if (immediate || !this.clip || holdingWorking || this.clipOwner !== "activity" || this.clipFrames >= HOLD_FRAMES) {
			this.startLoop(spec);
			return;
		}
		this.pending = { dueFrame: HOLD_FRAMES, run: () => this.startLoop(spec) };
	}

	/** After the last tool, a short gap keeps the tool clip on screen before the working loop returns. */
	private queueWorkingAfterGap(): void {
		// The activity is already the model's; only the clip waits out the gap, so a
		// pause or reload during it resumes the working loop instead of a stale tool.
		this.activity = "working";
		if (!this.ready) {
			this.leaveClip();
			this.changed();
			return;
		}
		const run = () => this.startLoop(this.workingSpec());
		if (!this.clip || this.clipOwner !== "activity") {
			run();
			return;
		}
		// A millisecond tool still gets its full minimum hold, then the gap.
		this.pending = { dueFrame: Math.max(HOLD_FRAMES, this.clipFrames + TOOL_GAP_FRAMES), run };
	}

	private switchTo(spec: LoopSpec, immediate: boolean): void {
		if (immediate || !this.clip || this.clipOwner !== "activity" || this.clipFrames >= HOLD_FRAMES) {
			this.startLoop(spec);
			return;
		}
		this.pending = { dueFrame: HOLD_FRAMES, run: () => this.startLoop(spec) };
	}

	private startLoop(spec: LoopSpec, fps?: number): void {
		if (!this.ready) {
			this.leaveClip();
			this.changed();
			return;
		}
		this.clipOnce = false;
		this.clearTimer();
		this.pending = undefined;
		this.clipFrames = 0;
		const frameMs = 1000 / (fps ?? officialSpriteMetadata(spec.name).fps);
		const show = (frame: number): void => {
			this.clip = { name: spec.name, frame };
			this.clipOwner = "activity";
			this.clipFrames += 1;
			this.changed();
			this.after(frameMs, () => {
				if (this.applyPending()) return;
				if (this.checkTired()) return;
				show(frame >= spec.loopTo ? spec.loopFrom : frame + 1);
			});
		};
		show(spec.start);
	}

	private checkTired(): boolean {
		if (this.activity !== "working" || this.clip?.name !== "Desktop" || !this.tired()) return false;
		this.startLoop(loopOf("Swaying"));
		return true;
	}

	private applyPending(): boolean {
		if (!this.pending || this.clipFrames < this.pending.dueFrame) return false;
		const run = this.pending.run;
		this.pending = undefined;
		run();
		return true;
	}

	private queueIdle(): void {
		if (!this.ready || this.activity !== "idle") return;
		const idleMs = this.now() - this.idleSince;
		const sleepAfter = this.isNight() ? NIGHT_SLEEP_MS : SLEEP_MS;
		if (idleMs >= sleepAfter) {
			this.activity = "sleeping";
			this.enterActivity(true);
			return;
		}
		const due = Math.min(this.nextBlinkAt, this.nextActionAt);
		this.after(Math.max(0, due - this.now()), () => this.idleTick());
	}

	/** Blink and act on separate clocks, so the act pool is not diluted by blinks. */
	private idleTick(): void {
		if (!this.ready || this.activity !== "idle") return;
		const now = this.now();
		if (now >= this.nextBlinkAt) {
			this.nextBlinkAt = now + BLINK_MIN_MS + Math.floor(this.random() * BLINK_JITTER_MS);
			this.playBuiltin("blink", 160);
			return;
		}
		if (now >= this.nextActionAt) {
			this.nextActionAt = now + this.actionDelay();
			this.idleAction();
			return;
		}
		this.queueIdle();
	}

	private actionDelay(): number {
		const min = this.crowded ? CROWDED_ACTION_MIN_MS : ACTION_MIN_MS;
		const jitter = this.crowded ? CROWDED_ACTION_JITTER_MS : ACTION_JITTER_MS;
		return min + Math.floor(this.random() * jitter);
	}

	private idleAction(): void {
		if (!this.ready || this.activity !== "idle") return;
		const roll = this.random() * (LOOK_WEIGHT * 2 + IDLE_CLIP_WEIGHT);
		if (roll < LOOK_WEIGHT) {
			this.playBuiltin("look-left", 650);
			return;
		}
		if (roll < LOOK_WEIGHT * 2) {
			this.playBuiltin("look-right", 650);
			return;
		}
		this.playOnce(this.drawIdleClip(), () => this.enterActivity(true));
	}

	/** A bag of every idle clip, so none of the official animations can starve. */
	private drawIdleClip(): OfficialSpriteName {
		if (this.idleBag.length === 0) {
			const bag: OfficialSpriteName[] = [];
			for (const [name, weight] of FOOTER_IDLE_CLIPS) for (let i = 0; i < weight; i++) bag.push(name);
			for (const [name, weight] of STAGE_IDLE_CLIPS) for (let i = 0; i < weight; i++) bag.push(name);
			if (this.crowded) for (let i = 0; i < 8; i++) bag.push("Dizzy");
			for (let i = bag.length - 1; i > 0; i--) {
				const j = Math.floor(this.random() * (i + 1));
				[bag[i], bag[j]] = [bag[j]!, bag[i]!];
			}
			this.idleBag = bag;
		}
		return this.idleBag.pop()!;
	}

	private playBuiltin(pose: ClawdPose, durationMs: number): void {
		this.clipOnce = false;
		this.clearTimer();
		this.pending = undefined;
		this.clip = undefined;
		this.clipOwner = undefined;
		this.pose = pose;
		this.changed();
		this.after(durationMs, () => {
			this.pose = "standing";
			this.enterActivity(true);
		});
	}

	private playOnce(name: OfficialSpriteName, done: () => void, owner: "activity" | "manual" = "activity"): void {
		this.clipOnce = true;
		this.clearTimer();
		this.pending = undefined;
		this.clipFrames = 0;
		const { fps, frameCount } = officialSpriteMetadata(name);
		const frameMs = 1000 / fps;
		const show = (frame: number): void => {
			this.clip = { name, frame };
			this.clipOwner = owner;
			this.clipFrames += 1;
			this.changed();
			this.after(frameMs, () => {
				if (frame + 1 < frameCount) show(frame + 1);
				else {
					this.clip = undefined;
					this.clipOwner = undefined;
					this.pose = "standing";
					this.changed();
					done();
				}
			});
		};
		show(0);
	}

	private isNight(): boolean {
		const hour = new Date(this.now()).getHours();
		return hour >= 22 || hour < 6;
	}

	private pick<T>(values: readonly T[]): T {
		return values[Math.min(values.length - 1, Math.floor(this.random() * values.length))]!;
	}

	private clearTimer(): void {
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
	}

	private after(delayMs: number, callback: () => void): void {
		this.clearTimer();
		const generation = this.generation;
		this.cancelTimer = this.schedule(() => {
			if (this.disposed || generation !== this.generation) return;
			this.cancelTimer = undefined;
			callback();
		}, delayMs);
	}
}