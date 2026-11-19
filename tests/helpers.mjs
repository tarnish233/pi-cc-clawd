import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPiInstall } from "../scripts/host-paths.mjs";
export { findPiInstall };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let importer;
export async function load(name) {
	if (!importer) {
		const host = findPiInstall();
		const { createJiti } = await import(pathToFileURL(host.jiti).href);
		importer = createJiti(pathToFileURL(path.join(root, "index.ts")).href, {
			alias: {
				"@earendil-works/pi-coding-agent": path.join(host.codingAgent, "dist", "index.js"),
				"@earendil-works/pi-tui": path.join(host.tui, "dist", "index.js"),
			},
		});
	}
	return importer.import(name.startsWith("@") || path.isAbsolute(name) ? name : path.join(root, name));
}

export class FakeClock {
	time = 0;
	jobs = new Map();
	nextId = 1;
	schedule = (callback, delay) => {
		const id = this.nextId++;
		this.jobs.set(id, { callback, at: this.time + delay });
		return () => this.jobs.delete(id);
	};
	advance(ms) {
		const end = this.time + ms;
		for (;;) {
			const next = [...this.jobs.entries()].filter(([,job]) => job.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
			if (!next) break;
			const [id,job] = next;
			this.jobs.delete(id);
			this.time = job.at;
			job.callback();
		}
		this.time = end;
	}
}

export async function makeTheme(mode = "truecolor", name = "dark") {
	const host = findPiInstall();
	const themeModule = await load(path.join(host.codingAgent, "dist/modes/interactive/theme/theme.js"));
	return themeModule.loadThemeFromPath(path.join(host.codingAgent, "dist/modes/interactive/theme", name + ".json"), mode);
}

export async function makeEditorEnvironment(columns = 80, rows = 32, { images = "kitty" } = {}) {
	if (images !== "auto") {
		const { setCapabilities } = await load("@earendil-works/pi-tui");
		setCapabilities({ images, trueColor: true, hyperlinks: true });
	}
	const theme = await makeTheme();
	const { getSelectListTheme } = await load("@earendil-works/pi-coding-agent");
	const host = findPiInstall();
	const { KeybindingsManager } = await load(path.join(host.codingAgent, "dist/core/keybindings.js"));
	const keybindings = KeybindingsManager.create();
	const tui = {
		terminal: { columns, rows, output: "", write(text) { this.output += text; } },
		fullRedraws: 0,
		renders: 0,
		overlays: [],
		requestRender() { this.renders++; },
		showOverlay(component, options) {
			const handle = {
				component, options, hidden: false, removed: false,
				setHidden(hidden) { this.hidden = hidden; },
				isHidden() { return this.hidden; },
				hide() { this.removed = true; this.hidden = true; },
				focus() {}, unfocus() {}, isFocused() { return false; }, getBounds() { return undefined; },
			};
			this.overlays.push(handle);
			return handle;
		},
	};
	return { theme, tui, keybindings, editorTheme: { borderColor: text => theme.fg("border", text), selectList: getSelectListTheme(theme) } };
}

export async function extensionHarness(mode = "tui", baseFactory) {
	const env = await makeEditorEnvironment();
	const { CustomEditor } = await load("@earendil-works/pi-coding-agent");
	const handlers = new Map();
	const commands = new Map();
	const entries = [];
	const notices = [];
	const statuses = new Map();
	const widgets = new Map();
	let footerFactory;
	let footer;
	let footerSets = 0;
	let editorSets = 0;
	const editor = new CustomEditor(env.tui, env.editorTheme, env.keybindings, { embedWorkingStatus: true });
	const forbidden = () => { throw new Error("The mascot must not replace the prompt editor, tools, or messages"); };
	const footerData = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map(statuses),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
	const ctx = {
		mode, hasUI: mode === "tui" || mode === "rpc", cwd: root,
		sessionManager: { getBranch: () => entries, getEntries: () => entries, getSessionName: () => undefined, getLeafId: () => undefined },
		getContextUsage: () => null, model: undefined, thinkingLevel: "off",
		ui: {
			get theme() { return env.theme; },
			getEditorComponent: () => baseFactory,
			getEditorText: () => editor.getText(),
			setEditorComponent: forbidden,
			notify: (...args) => notices.push(args),
			setEditorText: forbidden,
			setFooter(factory) {
				footer?.dispose?.();
				footerFactory = factory;
				footerSets++;
				footer = factory?.(env.tui, env.theme, footerData);
			},
			setStatus(key, text) { if (text === undefined) statuses.delete(key); else statuses.set(key,text); },
			setWidget(key, factory, options = {}) {
				widgets.get(key)?.dispose?.(); widgets.delete(key);
				if (factory) widgets.set(key, { component: factory(env.tui,env.theme), placement: options.placement ?? "aboveEditor" });
			},
		},
	};
	const pi = {
		on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name,list); return () => {}; },
		registerCommand: (name, command) => commands.set(name, command),
		appendEntry: (customType,data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
		getAllTools: () => [], getCommands: () => [], getSettings: () => ({}),
		registerTool: forbidden, sendUserMessage: forbidden, sendMessage: forbidden,
	};
	return {
		...env, ctx, pi, entries, notices, commands, statuses, widgets, footerData,
		get editor() { return editor; },
		get editorSets() { return editorSets; },
		get footer() { return footer; },
		get footerFactory() { return footerFactory; },
		get footerSets() { return footerSets; },
		get widget() { return widgets.get("pi-cc-clawd"); },
		async emitRaw(name, event = {}) { for (const handler of handlers.get(name) ?? []) await handler(event,ctx); },
		async emit(name, event = {}) {
			await this.emitRaw(name,event);
			// Match AgentSession.bindExtensions: resource discovery follows all startup handlers.
			if (name === "session_start") await this.emitRaw("resources_discover",{cwd:root,reason:"startup"});
		},
		async command(args = "") { await commands.get("clawd").handler(args,ctx); },
		resetEditor() { footer?.dispose?.(); footer = undefined; footerFactory = undefined; },
	};
}
