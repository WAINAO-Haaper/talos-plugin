import type { RuntimeInputBlock } from "../../contracts/runtime-adapter";

export interface DecodedRuntimeImage {
	id: string;
	name: string;
	mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	base64: string;
}

const IMAGE_DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i;

export function decodeRuntimeImages(input: RuntimeInputBlock[] | undefined): DecodedRuntimeImage[] {
	return (input ?? []).flatMap((block) => {
		if (block.type !== "image") return [];
		const match = IMAGE_DATA_URL.exec(block.dataUrl);
		if (!match || match[1] !== block.mimeType || !match[2] || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(block.mimeType)) {
			throw new Error(`图片附件格式无效：${block.name}`);
		}
		return [{
			id: block.id,
			name: block.name,
			mimeType: block.mimeType as DecodedRuntimeImage["mimeType"],
			base64: match[2],
		}];
	});
}
