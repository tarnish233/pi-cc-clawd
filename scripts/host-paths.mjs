import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/** Test/dev helper only: runtime imports are supplied by Pi itself. */
export function findPiInstall() {
	let root = process.env.PI_CC_CLAWD_HOST_NODE_MODULES;
	if (!root) {
		try {
			root = path.resolve(path.dirname(require.resolve("@earendil-works/pi-coding-agent")), "../../..");
		} catch {
			const agentDir = process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
			const releases = path.join(agentDir, "install", "releases");
			const versions = fs.existsSync(releases) ? fs.readdirSync(releases).filter(name =>
				fs.existsSync(path.join(releases, name, "node_modules", "jiti", "lib", "jiti.mjs"))) : [];
			versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
			if (!versions.length) throw new Error("Install Pi or set PI_CC_CLAWD_HOST_NODE_MODULES to its node_modules directory.");
			root = path.join(releases, versions.at(-1), "node_modules");
		}
	}
	const codingAgent = path.join(root, "@earendil-works", "pi-coding-agent");
	const tui = path.join(root, "@earendil-works", "pi-tui");
	return {
		root,
		codingAgent,
		tui,
		jiti: path.join(root, "jiti", "lib", "jiti.mjs"),
		version: JSON.parse(fs.readFileSync(path.join(codingAgent, "package.json"), "utf8")).version,
	};
}
