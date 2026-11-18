export interface ClawdPreferences {
	enabled: boolean;
	motion: boolean;
}

export const PREFERENCES_ENTRY = "pi-cc-clawd/preferences";
export const DEFAULT_PREFERENCES: Readonly<ClawdPreferences> = { enabled: true, motion: true };

interface PreferenceEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

/** Only this extension's preferences on the active branch are restored. */
export function readPreferences(entries: readonly PreferenceEntry[]): ClawdPreferences {
	let preferences = { ...DEFAULT_PREFERENCES };
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PREFERENCES_ENTRY) continue;
		const data = entry.data;
		if (data === null || typeof data !== "object") continue;
		const candidate = data as Partial<ClawdPreferences>;
		if (typeof candidate.enabled !== "boolean" || typeof candidate.motion !== "boolean") continue;
		preferences = { enabled: candidate.enabled, motion: candidate.motion };
	}
	return preferences;
}
