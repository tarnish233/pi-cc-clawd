import fs from "node:fs";
import { load,makeEditorEnvironment } from "../tests/helpers.mjs";
const { CustomEditor }=await load("@earendil-works/pi-coding-agent");
const { ClawdPortrait }=await load("sprite.ts");
const { decorateFooter,CLAWD_PLACEHOLDER }=await load("footer-adapter.ts");
const { stripTerminalSequences,colorToHex,indexedColor }=await load("@earendil-works/pi-tui");
const poses=["standing","blink","look-left","look-right"];
const args=process.argv.slice(2);
const pose=args.find(value=>poses.includes(value))??"standing";
const env=await makeEditorEnvironment(process.stdout.columns||80,32,{images:"auto"});
class PreviewEditor extends CustomEditor {
	render(width){const lines=super.render(width);lines[1]="❯ "+lines[1].slice(2);return lines;}
}
const editor=new PreviewEditor(env.tui,env.editorTheme,env.keybindings,{embedWorkingStatus:true});
editor.setPaddingX(2);editor.setText("Tell me about Clawd");
const portrait=new ClawdPortrait(()=>({enabled:true,motion:true,pose}),()=>env.theme,()=>env.tui.terminal.rows);
const footer=decorateFooter({
	render:()=>[
		env.theme.fg("dim","  Model · Context · Rate · Cost (existing footer)"),
		env.theme.fg("dim","  Project · Git")+env.theme.fg("muted"," · ")+env.theme.fg("dim",CLAWD_PLACEHOLDER),
	],invalidate(){},
},portrait);
const lines=editor.render(env.tui.terminal.columns);
lines.push(...footer.render(env.tui.terminal.columns));
const htmlIndex=args.indexOf("--html");
if(htmlIndex<0)console.log(lines.join("\n"));
else {
	const output=args[htmlIndex+1];if(!output)throw new Error("--html needs an output path");
	const escape=text=>text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
	function ansiHtml(line){
		let html="",start=0,fg,bg,bold=false,dim=false;
		const pattern=/\x1b\[([0-9;]*)m/g;
		const append=text=>{
			const value=escape(stripTerminalSequences(text));if(!value)return;
			const style=[fg&&"color:"+fg,bg&&"background:"+bg,bold&&"font-weight:700",dim&&"opacity:.65"].filter(Boolean).join(";");
			html+='<span style="'+style+'">'+value+'</span>';
		};
		let match;
		while((match=pattern.exec(line))){
			append(line.slice(start,match.index));
			const codes=match[1]?match[1].split(";").map(Number):[0];
			for(let i=0;i<codes.length;i++){
				const code=codes[i];
				if(code===0){fg=bg=undefined;bold=dim=false;}
				else if(code===1)bold=true;else if(code===2)dim=true;else if(code===22)bold=dim=false;
				else if(code===39)fg=undefined;else if(code===49)bg=undefined;
				else if((code===38||code===48)&&codes[i+1]===2){
					const color="rgb("+codes.slice(i+2,i+5).join(",")+")";if(code===38)fg=color;else bg=color;i+=4;
				}else if((code===38||code===48)&&codes[i+1]===5){
					const color=colorToHex(indexedColor(codes[i+2]));if(code===38)fg=color;else bg=color;i+=2;
				}
			}
			start=pattern.lastIndex;
		}
		append(line.slice(start));return html;
	}
	let images="";
	for(let row=0;row<lines.length;row++){
		const line=lines[row];const start=line.indexOf("\x1b_G");if(start<0)continue;
		const commands=[...line.matchAll(/\x1b_G([^;]*);([A-Za-z0-9+/=]*)\x1b\\/g)];
		if(!commands.length)continue;
		const controls=commands[0][1];const columns=Number(/(?:^|,)c=(\d+)/.exec(controls)?.[1]);
		const rows=Number(/(?:^|,)r=(\d+)/.exec(controls)?.[1]);
		const col=stripTerminalSequences(line.slice(0,start)).length;
		const data=commands.map(command=>command[2]).join("");
		images+='<img src="data:image/png;base64,'+data+'" style="left:'+col+'ch;top:'+row+'lh;width:'+columns+'ch;height:'+rows+'lh">';
	}
	fs.writeFileSync(output,'<!doctype html><html><meta charset="utf-8"><title>pi-cc-clawd preview</title>'+
		'<style>body{margin:0;padding:30px;background:#1b1b1b;color:#ddd}.terminal{position:relative;font:16px/1.2 Menlo,Monaco,monospace;'+
		'font-variant-ligatures:none;width:'+env.tui.terminal.columns+'ch}pre{font:inherit;margin:0;white-space:pre}'+
		'.terminal img{position:absolute;image-rendering:pixelated}p{font:13px system-ui;color:#8d8d8d;margin-top:22px}</style>'+
		'<div class="terminal"><pre>'+lines.map(ansiHtml).join("\n")+'</pre>'+images+'</div><p>Rendered from pi-cc-clawd + the actual Pi editor. Footer text is illustrative.</p></html>');
	console.log("Saved preview: "+output);
}
