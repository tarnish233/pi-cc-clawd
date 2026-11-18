import { DEFAULT_PREFERENCES, type ClawdPreferences } from "./preferences.ts";
import {
	officialSpriteMetadata,
	type OfficialSpriteName,
} from "./official-sprites.ts";

export type ClawdPose = "standing" | "blink" | "look-left" | "look-right";
export type ClawdActivity = "idle" | "working" | "tools" | "compacting" | "success" | "error";
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

const IDLE_CLIPS: readonly OfficialSpriteName[] = [
	"LookingAround", "LookingAroundEyesOnly", "Excited", "Swaying", "Turning", "Walking", "Dizzy", "Hula",
];

/** One cancellable timer drives both quiet idle delays and 12 fps clip playback. */
export class ClawdAnimation {
	private preferences: ClawdPreferences = { ...DEFAULT_PREFERENCES };
	private pose: ClawdPose = "standing";
	private activity: ClawdActivity = "idle";
	private clip: ClawdClip | undefined;
	private clipOwner: "activity" | "manual" | undefined;
	private agentActive = false;
	private failed = false;
	private readonly tools = new Set<string>();
	private started = false;
	private disposed = false;
	private cancelTimer: (() => void) | undefined;
	private generation = 0;

	constructor(
		private readonly changed: () => void,
		private readonly schedule: Schedule = scheduleTimeout,
		private readonly random: () => number = Math.random,
	) {}

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
		// The footer already paints its initial standing frame; do not redraw it twice.
		if (this.activity === "idle") this.queueIdle();
		else this.runActivity();
	}

	setPreferences(preferences: ClawdPreferences): void {
		if (this.disposed) return;
		if (preferences.enabled === this.preferences.enabled && preferences.motion === this.preferences.motion) return;
		this.preferences = { ...preferences };
		this.runActivity();
	}

	agentStart(): void {
		this.agentActive = true;
		this.failed = false;
		this.transition("working");
	}

	agentSettled(aborted: boolean): void {
		const failed = this.failed;
		this.failed = false;
		this.agentActive = false;
		this.tools.clear();
		this.transition(aborted ? "idle" : failed ? "error" : "success");
	}

	toolStart(id: string): void {
		this.tools.add(id);
		this.transition("tools");
	}

	toolEnd(id: string, isError: boolean): void {
		this.tools.delete(id);
		if (isError) this.transition("error");
		else this.transition(this.agentActive ? (this.tools.size ? "tools" : "working") : "idle");
	}

	compactStart(): void {
		this.transition("compacting");
	}

	compactEnd(willRetry: boolean): void {
		this.transition(willRetry || this.agentActive ? "working" : "success");
	}

	compactFailed(aborted: boolean): void {
		this.transition(aborted ? (this.agentActive ? "working" : "idle") : "error");
	}

	turnError(): void {
		this.failed = true;
		this.transition("error");
	}

	/** A one-shot blink also works while autonomous motion is paused. */
	blink(): void {
		if (!this.started || this.disposed || !this.preferences.enabled) return;
		this.playBuiltin("blink", 160);
	}

	/** Play any official clip once, including while paused. */
	playOfficial(name: OfficialSpriteName): boolean {
		if (!this.started || this.disposed || !this.preferences.enabled) return false;
		this.playClipOnce(name, () => this.runActivity(), "manual");
		return true;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearTimer();
	}

	private transition(activity: ClawdActivity): void {
		if (this.disposed) return;
		// Repeated events for the same state-owned clip must not restart it. A
		// same-named manual clip never suppresses a real state transition.
		if (activity === this.activity && this.clip && this.clipOwner === "activity" && (
			(activity === "working" && this.clip.name === "Desktop") ||
			(activity === "tools" && this.clip.name === "CrabWalking") ||
			(activity === "compacting" && this.clip.name === "Meditating") ||
			(activity === "success" && this.clip.name === "DancingHappy") ||
			(activity === "error" && this.clip.name === "Facepalm")
		)) return;
		this.activity = activity;
		this.runActivity();
	}

	private runActivity(): void {
		this.clearTimer();
		this.clip = undefined;
		this.clipOwner = undefined;
		this.pose = "standing";
		if (!this.started || this.disposed || !this.preferences.enabled || !this.preferences.motion) {
			this.changed();
			return;
		}
		switch (this.activity) {
			case "working": this.playClipLoop("Desktop", 2, 15, 75); break;
			case "tools": this.playClipLoop("CrabWalking", 0, 0, officialSpriteMetadata("CrabWalking").frameCount - 1); break;
			case "compacting": this.playClipLoop("Meditating", 0, 0, officialSpriteMetadata("Meditating").frameCount - 1); break;
			case "success":
				this.playClipOnce("DancingHappy", () => { this.activity = "idle"; this.runActivity(); });
				break;
			case "error":
				this.playClipOnce("Facepalm", () => {
					this.activity = this.agentActive ? (this.tools.size ? "tools" : "working") : "idle";
					this.runActivity();
				});
				break;
			case "idle":
				this.changed();
				this.queueIdle();
				break;
		}
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

	private queueIdle(): void {
		if (!this.started || this.disposed || !this.preferences.enabled || !this.preferences.motion || this.activity !== "idle") return;
		this.after(4500 + Math.floor(this.random() * 3500), () => {
			const choice = this.random();
			if (choice < 0.6) this.playBuiltin("blink", 160);
			else if (choice < 0.7) {
				const name = IDLE_CLIPS[Math.floor(this.random() * IDLE_CLIPS.length)] ?? IDLE_CLIPS[0];
				this.playClipOnce(name, () => this.runActivity());
			} else this.playBuiltin(choice < 0.85 ? "look-left" : "look-right", 650);
		});
	}

	private playBuiltin(pose: ClawdPose, durationMs: number): void {
		this.clearTimer();
		this.clip = undefined;
		this.clipOwner = undefined;
		this.pose = pose;
		this.changed();
		this.after(durationMs, () => this.runActivity());
	}

	private playClipLoop(name: OfficialSpriteName, start: number, loopStart: number, loopEnd: number): void {
		const frameMs = 1000 / officialSpriteMetadata(name).fps;
		const show = (frame: number): void => {
			this.clip = { name, frame };
			this.clipOwner = "activity";
			this.changed();
			this.after(frameMs, () => show(frame >= loopEnd ? loopStart : frame + 1));
		};
		show(start);
	}

	private playClipOnce(name: OfficialSpriteName, done: () => void, owner: "activity" | "manual" = "activity"): void {
		const { fps, frameCount } = officialSpriteMetadata(name);
		const frameMs = 1000 / fps;
		const show = (frame: number): void => {
			this.clip = { name, frame };
			this.clipOwner = owner;
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
}
