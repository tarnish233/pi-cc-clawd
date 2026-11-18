import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPiInstall } from "./host-paths.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
try {
	const compiler = process.env.PI_TYPESCRIPT_PATH ?? require.resolve("typescript");
	const module = await import(pathToFileURL(path.resolve(compiler)).href);
	const ts = module.default ?? module;
	const host = findPiInstall();
	const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
	config.config.compilerOptions = {
		...config.config.compilerOptions,
		typeRoots: [path.join(root, "node_modules", "@types"), path.join(host.root, "@types")],
		paths: {
			"@earendil-works/pi-coding-agent": [path.join(host.codingAgent, "dist", "index.d.ts")],
			"@earendil-works/pi-tui": [path.join(host.tui, "dist", "index.d.ts")],
		},
	};
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
	const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
	const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
	if (diagnostics.length) {
		process.stderr.write(ts.formatDiagnostics(diagnostics, {
			getCurrentDirectory: () => root,
			getCanonicalFileName: file => file,
			getNewLine: () => "\n",
		}));
		process.exitCode = 1;
	} else console.log("Typecheck passed (Pi " + host.version + ", TypeScript " + ts.version + ")");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error("Run npm install --legacy-peer-deps, or set PI_TYPESCRIPT_PATH to an existing typescript/lib/typescript.js.");
	process.exitCode = 1;
}
