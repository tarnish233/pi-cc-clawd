import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";

export function decodePng(png) {
	assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
	let offset=8,width,height;const compressed=[];const types=[];
	while(offset<png.length){
		const size=png.readUInt32BE(offset);const type=png.toString("ascii",offset+4,offset+8);
		const data=png.subarray(offset+8,offset+8+size);
		assert.equal(png.readUInt32BE(offset+8+size),crc32(png.subarray(offset+4,offset+8+size)));
		types.push(type);
		if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.equal(data[9],6);}
		if(type==="IDAT")compressed.push(data);
		offset+=size+12;
	}
	assert.deepEqual(types,["IHDR","IDAT","IEND"]);
	const raw=inflateSync(Buffer.concat(compressed));const rgba=Buffer.alloc(width*height*4);
	assert.equal(raw.length,(width*4+1)*height);
	for(let y=0;y<height;y++){assert.equal(raw[y*(width*4+1)],0);raw.copy(rgba,y*width*4,y*(width*4+1)+1,(y+1)*(width*4+1));}
	return {width,height,rgba,pixel:(x,y)=>[...rgba.subarray((y*width+x)*4,(y*width+x)*4+4)]};
}
