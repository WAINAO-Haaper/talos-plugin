import { open, rename, rmdir as removeEmptyDirectory } from "node:fs/promises";
import path from "node:path";
import type { PortableFileAdapter } from "./portable-conversation-store";

export interface VaultDataAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, value: string): Promise<void>;
	remove(path: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export function storageSyncOpenFlags(platform: NodeJS.Platform): "r" | "r+" {
	return platform === "win32" ? "r+" : "r";
}

export function supportsDirectoryFsync(platform: NodeJS.Platform): boolean {
	return platform !== "win32";
}

function relativePath(value: string): string {
	if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
		throw new Error("工作台存储路径必须是 Vault 相对路径");
	}
	const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
	if (normalized === ".." || normalized.startsWith("../")) {
		throw new Error("工作台存储路径越过 Vault 边界");
	}
	return normalized;
}

export class ObsidianWorkbenchStorage implements PortableFileAdapter {
	private readonly basePath: string;
	private readonly pendingFlush = new Set<string>();

	constructor(
		private readonly adapter: VaultDataAdapter,
		basePath: string,
		private readonly platform = process.platform,
	) {
		if (!path.isAbsolute(basePath)) throw new Error("Vault 根目录必须是绝对路径");
		this.basePath = path.resolve(basePath);
	}

	private absolute(relative: string): string {
		const resolved = path.resolve(this.basePath, relativePath(relative));
		if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
			throw new Error("工作台存储路径越过 Vault 边界");
		}
		return resolved;
	}

	private async ensureParent(file: string): Promise<void> {
		const directory = path.posix.dirname(relativePath(file));
		if (directory === ".") return;
		let current = "";
		for (const part of directory.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
		}
	}

	exists(file: string): Promise<boolean> { return this.adapter.exists(relativePath(file)); }
	read(file: string): Promise<string> { return this.adapter.read(relativePath(file)); }

	async write(file: string, value: string): Promise<void> {
		const relative = relativePath(file);
		await this.ensureParent(relative);
		await this.adapter.write(relative, value);
		this.pendingFlush.add(this.absolute(relative));
	}

	async rename(from: string, to: string): Promise<void> {
		await this.ensureParent(to);
		await rename(this.absolute(from), this.absolute(to));
		await this.flushDirectory(to);
	}

	async replace(from: string, to: string): Promise<void> {
		await this.rename(from, to);
	}

	remove(file: string): Promise<void> { return this.adapter.remove(relativePath(file)); }
	async rmdir(directory: string, recursive: boolean): Promise<void> {
		if (recursive) throw new Error("工作台存储禁止递归删除目录");
		await removeEmptyDirectory(this.absolute(directory));
	}

	async mkdir(directory: string): Promise<void> {
		const relative = relativePath(directory);
		if (!(await this.adapter.exists(relative))) await this.adapter.mkdir(relative);
	}

	async list(directory: string): Promise<{ files: string[]; folders: string[] }> {
		const listing = await this.adapter.list(relativePath(directory));
		return {
			files: listing.files.map((file) => path.posix.basename(file)).sort(),
			folders: listing.folders.map((folder) => path.posix.basename(folder)).sort(),
		};
	}

	async flush(): Promise<void> {
		for (const file of [...this.pendingFlush]) {
			// Windows permits fsync only on a writable handle. "r+" preserves
			// the existing bytes while retaining the atomic-write durability gate.
			const handle = await open(file, storageSyncOpenFlags(this.platform));
			try { await handle.sync(); } finally { await handle.close(); }
			this.pendingFlush.delete(file);
		}
	}

	private async flushDirectory(file: string): Promise<void> {
		// Windows does not expose directory fsync through Node file handles.
		if (!supportsDirectoryFsync(this.platform)) return;
		const handle = await open(path.dirname(this.absolute(file)), "r");
		try { await handle.sync(); } finally { await handle.close(); }
	}

	async readJson<T>(file: string): Promise<T | null> {
		if (!(await this.exists(file))) return null;
		return JSON.parse(await this.read(file)) as T;
	}

	async writeJsonAtomic(file: string, value: unknown): Promise<void> {
		const temporary = `${relativePath(file)}.tmp`;
		await this.write(temporary, `${JSON.stringify(value, null, 2)}\n`);
		await this.flush();
		await this.replace(temporary, file);
	}
}

export class ObsidianLegacyReadAdapter {
	constructor(private readonly adapter: VaultDataAdapter) {}
	read(file: string): Promise<string> { return this.adapter.read(relativePath(file)); }
	async listFiles(root: string): Promise<string[]> {
		const start = relativePath(root);
		if (!(await this.adapter.exists(start))) return [];
		const files: string[] = [];
		const visit = async (directory: string): Promise<void> => {
			const listing = await this.adapter.list(directory);
			files.push(...listing.files);
			for (const folder of listing.folders) await visit(folder);
		};
		await visit(start);
		return files.sort();
	}
}
