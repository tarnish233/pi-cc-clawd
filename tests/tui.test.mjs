import test from "node:test";
import assert from "node:assert/strict";
import { load,makeEditorEnvironment } from "./helpers.mjs";
const { TuiAltScreen,TuiMainScreen,VStack,stripTerminalSequences,setCapabilities,setCellDimensions }=await load("@earendil-works/pi-tui");
const { CustomEditor }=await load("@earendil-works/pi-coding-agent");
const { ClawdPortrait,FALLBACK_COLUMNS,FALLBACK_ROWS,TEXT_ROWS }=await load("sprite.ts");
const { FooterPlacement,CLAWD_FOOTER_KEY,CLAWD_PLACEHOLDER }=await load("footer-adapter.ts");
const { ClawdAnimation }=await load("animation.ts");

class Terminal {
	columns=80;
	rows=24;
	kittyProtocolActive=false;
	output="";
	input;
	resize;
	start(input,resize){this.input=input;this.resize=resize;}
	stop(){this.input=undefined;this.resize=undefined;}
	async drainInput(){}
	write(text){this.output+=text;}
	moveBy(n){if(n)this.write("\x1b["+Math.abs(n)+(n>0?"B":"A"));}
	hideCursor(){this.write("\x1b[?25l");}
	showCursor(){this.write("\x1b[?25h");}
	clearLine(){this.write("\x1b[2K");}
	clearFromCursor(){this.write("\x1b[J");}
	clearScreen(){this.write("\x1b[2J");}
	setTitle(){}
	setProgress(){}
	setProgramStatus(){}
}

for(const fullscreen of [false,true]) {
	test("real "+(fullscreen?"fullscreen":"regular")+" renderer puts the image in the existing footer second line",async()=>{
		const env=await makeEditorEnvironment();setCapabilities({images:"kitty",trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});
		const terminal=new Terminal();const tui=fullscreen?new TuiAltScreen(terminal,false,undefined,{copyOnSelect:false}):new TuiMainScreen(terminal);
		const editor=new CustomEditor(tui,env.editorTheme,env.keybindings,{embedWorkingStatus:true});editor.setText("hello");
		const animation=new ClawdAnimation(()=>placement.refresh(),()=>()=>{},()=>0);
		const statuses=new Map();let footer;let widget;let model="model";
		const footerData={getExtensionStatuses:()=>new Map(statuses),getGitBranch:()=>"main",getAvailableProviderCount:()=>1,onBranchChange:()=>()=>{}};
		const ctx={ui:{
			get theme(){return env.theme;},
			setFooter(factory){footer=factory?.(tui,env.theme,footerData);},
			setStatus(key,text){if(text===undefined)statuses.delete(key);else statuses.set(key,text);},
			setWidget(_key,factory){widget=factory?.(tui,env.theme);},
		}};
		const placement=new FooterPlacement(ctx,animation);placement.prepare();
		ctx.ui.setFooter(()=>({render:()=>[model,"cwd · main · "+(statuses.get(CLAWD_FOOTER_KEY)??"")],invalidate(){}}));
		placement.mountDefault();animation.start();
		const children=[editor,footer];if(fullscreen)tui.setLayoutRoot(new VStack(children));else for(const child of children)tui.addChild(child);
		tui.setFocus(editor);tui.start();
		const screen=()=>fullscreen?tui.getScreenLines():tui.captureRenderState().previousLines;
		try {
			tui.renderNow();assert.equal(editor.render(80).length,3);assert.equal(widget,undefined);
			const footerLines=footer.render(80);assert.equal(footerLines.length,2);assert(footerLines.every(line=>line.includes("\u{10eeee}")&&!line.includes("\x1b_G")));assert(!footerLines[1].includes(CLAWD_PLACEHOLDER));
			assert(screen().some(line=>line.includes("\u{10eeee}")));assert(screen().every(line=>!line.includes("\x1b_G")));assert(screen().map(stripTerminalSequences).some(line=>line.includes("model")));
			assert(terminal.output.includes("a=T,U=1"));
			assert.equal(editor.focused,true);
			if(fullscreen){
				const row=2;terminal.input("\x1b[<0;3;"+row+"M");terminal.input("\x1b[<0;3;"+row+"m");terminal.input("!");assert.equal(editor.getText(),"he!llo");
				for(const [y,text] of [[4,"model"],[5,"cwd"]]){
					terminal.input("\x1b[<0;1;"+y+"M");terminal.input("\x1b[<32;"+text.length+";"+y+"M");terminal.input("\x1b[<0;"+text.length+";"+y+"m");
					tui.renderNow();assert.equal(tui.getActiveSelectionText(),text);assert(tui.getScreenLines()[y-1].includes("\x1b[7m"));
				}
				terminal.output="";model="model · 42%";tui.renderNow();
				assert(!terminal.output.includes("\x1b_Ga=d"));assert(!terminal.output.includes("a=T"));assert(screen().map(stripTerminalSequences).some(line=>line.includes("model · 42%")));
			}
			animation.blink();tui.renderNow();assert(footer.render(80)[0].includes("\u{10eeee}"));
			animation.setPreferences({enabled:false,motion:true});placement.refresh();tui.renderNow();
			assert(!footer.render(80)[1].includes(CLAWD_PLACEHOLDER));assert(screen().every(line=>!line.includes("\u{10eeee}")));
			placement.dispose();animation.dispose();assert.equal(statuses.size,0);
		}finally{tui.stop();}
	});
}

for(const fullscreen of [false,true]) {
	test("real "+(fullscreen?"fullscreen":"regular")+" renderer lets a tall clip borrow the two lines above the footer",async()=>{
		const env=await makeEditorEnvironment();setCapabilities({images:"kitty",trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});
		const terminal=new Terminal();const tui=fullscreen?new TuiAltScreen(terminal,false,undefined,{copyOnSelect:false}):new TuiMainScreen(terminal);
		const editor=new CustomEditor(tui,env.editorTheme,env.keybindings,{embedWorkingStatus:true});editor.setText("hello");
		const queue=[];const schedule=callback=>{queue.push(callback);return()=>{};};
		const animation=new ClawdAnimation(()=>placement.refresh(),schedule,()=>0);
		const statuses=new Map();let footer;
		const footerData={getExtensionStatuses:()=>new Map(statuses),getGitBranch:()=>"main",getAvailableProviderCount:()=>1,onBranchChange:()=>()=>{}};
		const ctx={ui:{
			get theme(){return env.theme;},
			setFooter(factory){footer=factory?.(tui,env.theme,footerData);},
			setStatus(key,text){if(text===undefined)statuses.delete(key);else statuses.set(key,text);},
			setWidget(){},
		}};
		const placement=new FooterPlacement(ctx,animation);placement.prepare();
		ctx.ui.setFooter(()=>({render:()=>["model","cwd · main · "+(statuses.get(CLAWD_FOOTER_KEY)??"")],invalidate(){}}));
		placement.mountDefault();animation.start();
		const filler={render:()=>Array.from({length:terminal.rows-5},()=>" ".repeat(80)),invalidate(){}};
		const children=[filler,editor,footer];
		if(fullscreen)tui.setLayoutRoot(new VStack(children));else for(const child of children)tui.addChild(child);
		tui.setFocus(editor);tui.start();
		const screen=()=>fullscreen?tui.getScreenLines():tui.captureRenderState().previousLines;
		try {
			tui.renderNow();assert.equal(editor.render(80).length,3);assert.equal(tui.hasOverlay(),false);
			animation.playOfficial("Thinking");
			for(let i=0;i<6;i++)queue.shift()?.();
			tui.renderNow();assert.equal(tui.hasOverlay(),true);
			tui.renderNow();
			const rows=screen().map(stripTerminalSequences);
			const footerRow=rows.findIndex(line=>line.includes("cwd · main"));
			assert(footerRow>2);
			assert.equal(footerRow,rows.length-1);
			assert(rows[footerRow].includes("\u{10eeee}"));assert(rows[footerRow-1].includes("\u{10eeee}"));
			assert(rows[footerRow-2].includes("\u{10eeee}"));assert(rows[footerRow-2].includes("─"));
			assert(screen().every(line=>!line.includes("\x1b_G")));assert(terminal.output.includes("a=T,U=1"));
			// The next snapshots contain this stage's own cells; it must stay mounted.
			for(let i=0;i<8;i++){queue.shift()?.();tui.renderNow();assert.equal(tui.hasOverlay(),true);}
			animation.setPreferences({enabled:false,motion:true});placement.refresh();tui.renderNow();
			assert.equal(tui.hasOverlay(),false);assert(screen().every(line=>!line.includes("\u{10eeee}")));
			// A one-row stage (Waving) must leave the editor's input line untouched.
			animation.setPreferences({enabled:true,motion:true});placement.refresh();tui.renderNow();
			animation.playOfficial("Waving");
			for(let i=0;i<9;i++)queue.shift()?.();
			tui.renderNow();assert.equal(tui.hasOverlay(),true);
			const waving=screen().map(stripTerminalSequences);
			const wavingFooter=waving.findIndex(line=>line.includes("cwd · main"));
			assert(waving[wavingFooter].includes("\u{10eeee}"));assert(waving[wavingFooter-1].includes("\u{10eeee}"));
			assert(waving[wavingFooter-2].includes("\u{10eeee}"));assert(waving[wavingFooter-2].includes("─"));
			assert(!waving[wavingFooter-3].includes("\u{10eeee}"));
		}finally{tui.stop();}
	});
}

for(const protocol of [null,"kitty"])for(const fullscreen of [false,true]) {
	test("native fallback below editor keeps input coordinates and original footer with "+(protocol??"text"),async()=>{
		const env=await makeEditorEnvironment();setCapabilities({images:protocol,trueColor:true,hyperlinks:true});setCellDimensions({widthPx:9,heightPx:18});
		const terminal=new Terminal();const portraitRows=protocol==="kitty"?FALLBACK_ROWS:TEXT_ROWS;
		const tui=fullscreen?new TuiAltScreen(terminal,false,undefined,{copyOnSelect:false}):new TuiMainScreen(terminal);
		const editor=new CustomEditor(tui,env.editorTheme,env.keybindings,{embedWorkingStatus:true});editor.setText("hello");
		const portrait=new ClawdPortrait(()=>({enabled:true,motion:true,pose:"standing"}),()=>env.theme,()=>terminal.rows,{columns:FALLBACK_COLUMNS,rows:FALLBACK_ROWS});
		const footer={render:()=>["original footer one","original footer two"],invalidate(){}};
		const children=[editor,portrait,footer];if(fullscreen)tui.setLayoutRoot(new VStack(children));else for(const child of children)tui.addChild(child);
		tui.setFocus(editor);tui.start();const screen=()=>fullscreen?tui.getScreenLines():tui.captureRenderState().previousLines;
		try {
			tui.renderNow(true);assert.equal(editor.render(80).length,3);assert.equal(portrait.render(80).length,portraitRows);
			assert(screen().map(stripTerminalSequences).some(line=>line.includes("original footer two")));
			if(fullscreen){const row=2;terminal.input("\x1b[<0;3;"+row+"M");terminal.input("\x1b[<0;3;"+row+"m");terminal.input("!");assert.equal(editor.getText(),"he!llo");}
			terminal.columns=27;terminal.resize();tui.renderNow(true);assert.equal(portrait.render(27).length,0);
			assert(screen().map(stripTerminalSequences).some(line=>line.includes("original footer two")));
		}finally{tui.stop();}
	});
}

for (const fullscreen of [false, true]) {
	test("real " + (fullscreen ? "fullscreen" : "regular") + " renderer keeps the stage off while the session is shorter than the screen", async () => {
		const env = await makeEditorEnvironment(); setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true }); setCellDimensions({ widthPx: 9, heightPx: 18 });
		const terminal = new Terminal(); const tui = fullscreen ? new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false }) : new TuiMainScreen(terminal);
		const editor = new CustomEditor(tui, env.editorTheme, env.keybindings, { embedWorkingStatus: true }); editor.setText("hello");
		const queue = []; const schedule = callback => { queue.push(callback); return () => {}; };
		let placement;
		const animation = new ClawdAnimation(() => placement.refresh(), schedule, () => 0);
		const statuses = new Map(); let footer;
		const footerData = { getExtensionStatuses: () => new Map(statuses), getGitBranch: () => "main", getAvailableProviderCount: () => 1, onBranchChange: () => () => {} };
		const ctx = { ui: {
			get theme() { return env.theme; },
			getEditorText: () => editor.getText(),
			setFooter(factory) { footer = factory?.(tui, env.theme, footerData); },
			setStatus(key, text) { if (text === undefined) statuses.delete(key); else statuses.set(key, text); },
			setWidget() {},
		} };
		placement = new FooterPlacement(ctx, animation); placement.prepare();
		ctx.ui.setFooter(() => ({ render: () => ["model", "cwd · main · " + (statuses.get(CLAWD_FOOTER_KEY) ?? "")], invalidate() {} }));
		placement.mountDefault(); animation.start();
		const filler = { render: () => Array.from({ length: terminal.rows - 12 }, () => " ".repeat(80)), invalidate() {} };
		const children = [filler, editor, footer];
		if (fullscreen) tui.setLayoutRoot(new VStack(children)); else for (const child of children) tui.addChild(child);
		tui.setFocus(editor); tui.start();
		try {
			tui.renderNow();
			animation.playOfficial("Confetti");
			for (let i = 0; i < 9; i++) queue.shift()?.();
			tui.renderNow();
			assert.equal(tui.hasOverlay(), true);
			const rows = (fullscreen ? tui.getScreenLines() : tui.captureRenderState().previousLines).map(stripTerminalSequences);
			const footerRow = rows.findIndex(line => line.includes("cwd · main"));
			assert(footerRow > 3);
			assert(rows[footerRow - 2].includes("\u{10eeee}"));
			assert(rows[footerRow - 3].includes("\u{10eeee}"));
			assert(rows.slice(footerRow + 1).every(line => !line.includes("\u{10eeee}")));
		} finally {
			tui.stop(); animation.dispose(); placement.dispose();
		}
	});
}

test("real fullscreen renderer pets Clawd on a footer click", async () => {
	const env = await makeEditorEnvironment(); setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true }); setCellDimensions({ widthPx: 9, heightPx: 18 });
	const terminal = new Terminal(); const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
	const editor = new CustomEditor(tui, env.editorTheme, env.keybindings, { embedWorkingStatus: true }); editor.setText("");
	let placement;
	const animation = new ClawdAnimation(() => placement.refresh(), () => () => {}, () => 0);
	const statuses = new Map(); let footer;
	const footerData = { getExtensionStatuses: () => new Map(statuses), getGitBranch: () => "main", getAvailableProviderCount: () => 1, onBranchChange: () => () => {} };
	const ctx = { ui: {
		get theme() { return env.theme; },
		getEditorText: () => editor.getText(),
		setFooter(factory) { footer = factory?.(tui, env.theme, footerData); },
		setStatus(key, text) { if (text === undefined) statuses.delete(key); else statuses.set(key, text); },
		setWidget() {},
	} };
	placement = new FooterPlacement(ctx, animation); placement.prepare();
	ctx.ui.setFooter(() => ({ render: () => ["model", "cwd · main · " + (statuses.get(CLAWD_FOOTER_KEY) ?? "")], invalidate() {} }));
	placement.mountDefault(); animation.start();
	tui.setLayoutRoot(new VStack([editor, footer])); tui.setFocus(editor); tui.start();
	try {
		tui.renderNow();
		const rows = tui.getScreenLines().map(stripTerminalSequences);
		const modelRow = rows.findIndex(line => line.includes("model"));
		assert(modelRow >= 0);
		assert.equal(animation.getState().clip, undefined);
		const x = terminal.columns - 5; // inside the rightmost eight cells
		const y = modelRow + 2; // the footer's second row, SGR is one-based
		terminal.input(`\x1b[<0;${x};${y}M`);
		terminal.input(`\x1b[<0;${x};${y}m`);
		const clip = animation.getState().clip;
		assert(clip && ["Excited", "Hula", "Waving", "DancingHappy"].includes(clip.name));
	} finally {
		tui.stop(); animation.dispose(); placement.dispose();
	}
});
