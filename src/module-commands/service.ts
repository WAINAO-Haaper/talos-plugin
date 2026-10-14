import { MODULE_COMMAND_GROUPS, MODULE_ACTIONS } from "./catalog";
import { convertBasicFormat, decodeDataPackageFile, encodeDataPackageFile, getConversionSupport, parseDataPackage, serializeDataPackage, validateVaultRelativePath } from "./data-format";

export type ModuleDataKey = "inbox" | "logs" | "insights" | "assets" | "projects" | "archive" | "identity" | "output";
export type ModuleCommandRoots = Record<ModuleDataKey, string> & { system?: string };
const MODULE_DATA_KEYS: readonly ModuleDataKey[] = ["inbox", "logs", "insights", "assets", "projects", "archive", "identity", "output"];
export interface ModuleFile { path: string; extension: string; size: number; mtime: number }
export interface ModuleImportFile { name: string; content: Uint8Array }
export interface ModuleCommandHost {
 conditionalDelete?: boolean;
 roots(): ModuleCommandRoots;
 files(): ModuleFile[];
 exists(path: string): Promise<boolean>;
 read(path: string): Promise<Uint8Array>;
 /** expected=null means create-only; bytes mean compare-and-write. Never ignore expected. */
 write(path: string, content: Uint8Array, expected?: Uint8Array | null): Promise<void>;
 /** With expected bytes, delete only if the content still matches immediately before deletion. */
 remove(path: string, expected?: Uint8Array): Promise<void>;
 assertPath(path: string, write: boolean): Promise<void>;
 now(): Date;
}
export interface ModuleMutation { path: string; before: Uint8Array | null; after: Uint8Array }
export interface ModuleCommandPlan {
 readonly actionId: string;
 readonly summary: string;
 readonly details: readonly string[];
 readonly changes: readonly ModuleMutation[];
 readonly readPaths: readonly string[];
 readonly result: { message: string; paths: string[]; warnings: string[]; text?: string };
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const TEXT = new Set(["md", "txt", "json", "csv", "html", "htm", "srt", "vtt"]);
const MEDIA = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm", "mp3", "wav", "m4a"]);
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const value = (input: Record<string, unknown>, key: string, fallback = ""): string => typeof input[key] === "string" ? input[key].trim() : fallback;
function leafName(raw: string): string {
 // Filename sanitization intentionally replaces C0/DEL control characters.
 // eslint-disable-next-line no-control-regex
 const name = raw.trim().replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-").replace(/^\.+/, "").slice(0, 120);
 if (!name || name === "README" || name === "_README") throw new Error("请输入有效的文件名称");
 return name;
}
function yamlString(raw: string): string { return JSON.stringify(raw); }
function note(title: string, body: string, date: string, type = "笔记"): string {
 return `---\ntitle: ${yamlString(title)}\ndate: ${date}\ntags: [个人资料]\nstatus: inbox\ntype: ${yamlString(type)}\n---\n\n# ${title.replace(/[\r\n]/g, " ")}\n\n${body}\n`;
}
function setStatus(text: string, status: string): string {
 const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
 if (!fm) return `---\nstatus: ${status}\n---\n\n${text}`;
 const body = fm[1] ?? "";
 const next = /^status:/m.test(body) ? body.replace(/^status:.*$/m, `status: ${status}`) : `${body}\nstatus: ${status}`;
 return `---\n${next}\n---\n${text.slice(fm[0].length)}`;
}

function frontmatterState(text: string): "present" | "missing" | "manual" {
 if (text.charCodeAt(0) === 0xfeff) return "manual";
 if (!/^---\r?\n/.test(text)) return "missing";
 return /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.test(text) ? "present" : "manual";
}

function isReadme(path: string): boolean { return /(?:^|\/)_?README\.md$/i.test(path); }

interface PreparedPlan {
 snapshot: ModuleCommandPlan;
 reads: Map<string, Uint8Array>;
 roots: string;
 state: "prepared" | "applying" | "applied" | "failed" | "cancelled" | "undoing" | "undo-failed" | "undone";
}

function clonePlan(plan: ModuleCommandPlan): ModuleCommandPlan {
 return {
  actionId: plan.actionId, summary: plan.summary, details: [...plan.details],
  changes: plan.changes.map(change => ({ path: change.path, before: change.before === null ? null : new Uint8Array(change.before), after: new Uint8Array(change.after) })),
  readPaths: [...plan.readPaths],
  result: { ...plan.result, paths: [...plan.result.paths], warnings: [...plan.result.warnings] },
 };
}

function freezePlan(plan: ModuleCommandPlan): ModuleCommandPlan {
 for (const change of plan.changes) Object.freeze(change);
 Object.freeze(plan.changes); Object.freeze(plan.details); Object.freeze(plan.readPaths);
 Object.freeze(plan.result.paths); Object.freeze(plan.result.warnings); Object.freeze(plan.result);
 return Object.freeze(plan);
}

function checkCancelled(signal?: AbortSignal): void {
 if (signal?.aborted) throw new Error("已取消");
}

/** Native operations; preview/undo snapshots exist only for this service lifetime. */
export class ModuleCommandService {
 private readonly prepared = new WeakMap<ModuleCommandPlan, PreparedPlan>();
 private sequence = 0;
 constructor(private readonly host: ModuleCommandHost) {}
 private rootsKey(): string {
  return JSON.stringify(Object.entries(this.host.roots()).sort(([a], [b]) => a.localeCompare(b)));
 }
 private path(path: string): string {
  const safe = validateVaultRelativePath(path);
  const mapped = this.host.roots();
  const roots = MODULE_DATA_KEYS.map(key => validateVaultRelativePath(mapped[key]));
  const system = mapped.system ? validateVaultRelativePath(mapped.system) : "";
  const memory = Boolean(system) && (safe.startsWith(`${system}/working-memory/daily/`) || safe === `${system}/working-memory/candidates-staging.md`);
  if (!memory && !roots.some(root => safe === root || safe.startsWith(`${root}/`))) throw new Error("目标不属于已配置的数据模块");
  if (/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(safe) || /(?:^|\/)(?:credentials|secrets)(?:\/|\.|$)/i.test(safe)) throw new Error("系统规则或凭据不能作为通用命令目标");
  return safe;
 }
 private writePath(path: string, actionId: string): string {
  const safe = this.path(path);
  const identity = validateVaultRelativePath(this.host.roots().identity);
  const system = this.host.roots().system;
  if (system && (safe.startsWith(`${system}/working-memory/daily/`) || safe === `${system}/working-memory/candidates-staging.md`) && actionId !== "flow.cycle") {
   throw new Error("工作记忆仅能通过确认后的本地闭环写入");
  }
  if ((safe === identity || safe.startsWith(`${identity}/`)) && actionId !== "setup.initialize" && actionId !== "profile.update") {
   throw new Error("身份文件仅能通过身份或初始化专用入口修改");
  }
  return safe;
 }
 private files(): ModuleFile[] {
  return this.host.files().filter(file => { try { this.path(file.path); return true; } catch { return false; } });
 }
 async prepare(actionId: string, input: Record<string, unknown> = {}): Promise<ModuleCommandPlan> {
  const roots = { ...this.host.roots() };
  for (const root of Object.values(roots)) validateVaultRelativePath(root);
  const rootsKey = this.rootsKey(); const reads = new Map<string, Uint8Array>();
  const now = this.host.now(); const date = now.toISOString().slice(0, 10);
  const stamp = `${now.toISOString().replace(/[:.]/g, "-")}-${++this.sequence}`;
  const changes: ModuleMutation[] = []; const readPaths: string[] = []; const warnings: string[] = [];
  const paths: string[] = []; const details: string[] = []; let message = ""; let resultText: string | undefined;
  const read = async (raw: string): Promise<Uint8Array> => {
   const path = this.path(raw); await this.host.assertPath(path, false);
   const bytes = new Uint8Array(await this.host.read(path)); if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("单文件超过50 MiB，请分批处理");
   const prior = reads.get(path);
   if (prior && !equal(prior, bytes)) throw new Error("读取期间文件发生变化，请重新生成计划");
   reads.set(path, new Uint8Array(bytes)); readPaths.push(path); return bytes;
  };
  const create = async (raw: string, data: string | Uint8Array): Promise<void> => {
   const path = this.writePath(raw, actionId); await this.host.assertPath(path, true);
   const key = path.normalize("NFKC").toLowerCase();
   if (await this.host.exists(path) || changes.some(change => {
    const existing = change.path.normalize("NFKC").toLowerCase();
    return existing === key || existing.startsWith(`${key}/`) || key.startsWith(`${existing}/`);
   })) throw new Error("目标文件已存在或路径冲突，请选择新名称");
   changes.push({ path, before: null, after: typeof data === "string" ? encoder.encode(data) : new Uint8Array(data) }); paths.push(path);
  };
  const update = async (raw: string, transform: (text: string) => string): Promise<void> => {
   const path = this.writePath(raw, actionId); const before = await read(path); await this.host.assertPath(path, true);
   changes.push({ path, before: new Uint8Array(before), after: encoder.encode(transform(decoder.decode(before))) }); paths.push(path);
  };
  const selection = (): ModuleFile[] => {
   const raw = value(input, "paths", value(input, "path", value(input, "source")));
   const files = this.files();
   if (!raw) return files;
   const targets = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(x => this.path(x));
   return files.filter(f => targets.some(p => f.path === p || f.path.startsWith(`${p}/`)));
  };
  switch (actionId) {
   case "setup.inspect": case "system.status": case "system.help": {
    const files = this.files(); message = `当前数据模块共 ${files.length} 个文件`;
    if (actionId === "system.help") {
     message = "模块命令使用帮助";
     resultText = MODULE_COMMAND_GROUPS.map(group => `/${group.id} · ${group.label}\n${MODULE_ACTIONS.filter(action => action.group === group.id).map(action => `  ${action.label}${action.requiresCapabilities.length ? "（检查所需能力）" : ""}：${action.description}`).join("\n")}`).join("\n\n");
     break;
    }
    resultText = Object.entries(roots).map(([key, path]) => `${key}：${path}（${files.filter(f => f.path.startsWith(`${path}/`)).length}）`).join("\n");
    warnings.push("此处显示当前映射；未自动安装外部模型或工具。"); break;
   }
   case "setup.initialize": {
    for (const key of MODULE_DATA_KEYS) {
     const path = `${roots[key]}/README.md`;
     if (!await this.host.exists(path)) await create(path, `# ${roots[key].split("/").pop()}\n\n个人数据模块。原始资料由用户拥有；身份推断需确认，导入不自动授予外部访问。\n`);
    }
    const name = value(input, "owner_name"); const goal = value(input, "primary_goal");
    if (!name || !goal) throw new Error("请填写称呼和当前目标");
    const profile = `${roots.identity}/身份.md`;
    if (!await this.host.exists(profile)) await create(profile, note("身份", `## 称呼\n${name}\n\n## 当前目标\n${goal}\n\n## 重要上下文\n${value(input, "important_context", "待补充")}\n\n## 偏好与边界\n${value(input, "communication_preferences", "待补充")}\n${value(input, "hard_boundaries", "待补充")}\n\n## 敏感范围\n${value(input, "sensitive_paths", "未提供")}`, date, "system"));
    message = `补齐 ${changes.length} 份模块/身份文件，保留现有文件`; warnings.push("此操作初始化文件结构与确认身份；外部工具安装仍由设置引导。"); break;
   }
   case "capture.note": case "capture.journal": case "capture.task": {
    const body = value(input, "content", value(input, "text", value(input, "title"))); if (!body) throw new Error("请填写记录内容");
    const title = value(input, "title", actionId === "capture.journal" ? `${date} 记录` : "新记录");
    const folder = actionId === "capture.journal" ? roots.logs : roots.inbox;
    const content = actionId === "capture.task" ? `- [ ] ${body}\n\n此记录是任务线索，尚未执行。` : body;
    await create(`${folder}/${leafName(title)}-${stamp}.md`, note(title, content, date, actionId === "capture.journal" ? "daily-note" : "笔记"));
    message = "创建记录"; break;
   }
   case "project.new": {
    const title = value(input, "title", value(input, "name")); const goal = value(input, "goal", value(input, "content"));
    if (!title || !goal) throw new Error("请填写项目名称和目标");
    await create(`${roots.projects}/${leafName(title)}-${stamp}.md`, note(title, `## 目标\n${goal}\n\n## 下一步\n${value(input, "next", "待明确")}\n\n## 状态\n计划中\n\n## 成果与证据\n尚未完成。`, date, "project")); message = "创建项目记录"; break;
   }
   case "project.update": {
    const path = value(input, "path"); if (!path.startsWith(`${roots.projects}/`)) throw new Error("请选择项目模块中的文件");
    const content = value(input, "content", value(input, "update")); if (!content) throw new Error("请填写本次进度和依据");
    await update(path, text => `${text}\n\n## 进度记录 ${date}\n${content}\n`); message = "追加项目进度，保留原内容"; break;
   }
   case "project.status": {
    const files = this.files().filter(f => f.path.startsWith(`${roots.projects}/`) && f.extension === "md");
    paths.push(...files.map(f => f.path)); message = `${files.length} 个项目文件`; break;
   }
   case "profile.show": {
    const files = this.files().filter(f => f.path.startsWith(`${roots.identity}/`) && f.extension === "md");
    paths.push(...files.map(f => f.path)); message = `${files.length} 份身份与偏好文件`; break;
   }
   case "profile.update": {
    const name = value(input, "owner_name", value(input, "name")); const goal = value(input, "primary_goal", value(input, "goal"));
    const preferences = value(input, "communication_preferences", value(input, "preferences")); const boundaries = value(input, "hard_boundaries", value(input, "boundaries"));
    const content = value(input, "content");
    if (!content && (!name || !goal || !boundaries)) throw new Error("请填写称呼、目标和边界；未知内容可明确填写待补充");
    const addition = content || `## 称呼\n${name}\n\n## 当前目标\n${goal}\n\n## 沟通偏好\n${preferences || "待补充"}\n\n## 边界\n${boundaries}`;
    const preferred = `${roots.identity}/PROFILE.md`;
    const fallback = `${roots.identity}/偏好与边界.md`;
    const target = await this.host.exists(preferred) ? preferred : fallback;
    if (await this.host.exists(target)) await update(target, text => `${text}\n\n## 用户确认的补充 ${date}\n${addition}\n`);
    else await create(target, note("个人档案", addition, date, "system"));
    message = "向个人档案追加本轮确认内容"; warnings.push("保留原有内容；请在预览中检查与已有档案的冲突。"); break;
   }
   case "search.find": {
    const query = value(input, "query", value(input, "text")); if (!query) throw new Error("请输入搜索内容");
    const candidates = selection().filter(f => TEXT.has(f.extension.toLowerCase()));
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean); const matches: string[] = [];
    let scanned = 0;
    for (const file of candidates) {
     if (scanned >= 500) { warnings.push("本次最多扫描500个文件，请缩小目录范围继续搜索。"); break; }
     if (file.size > 2 * 1024 * 1024) { warnings.push(`跳过超出2 MiB的文本：${file.path}`); continue; }
     const text = decoder.decode(await read(file.path)); scanned++;
     if (terms.every(term => `${file.path}\n${text}`.toLocaleLowerCase().includes(term))) {
      paths.push(file.path); const line = text.split(/\r?\n/).find(x => terms.some(term => x.toLocaleLowerCase().includes(term))) ?? file.path;
      matches.push(`${file.path}\n${line.slice(0, 240)}`);
     }
    }
    message = `已扫描 ${scanned} 个文件，找到 ${paths.length} 条`; resultText = matches.join("\n\n"); break;
   }
   case "library.import": {
    const files = input.files as ModuleImportFile[] | undefined;
    if (!Array.isArray(files) || !files.length) throw new Error("请选择要导入的文件");
    if (files.some(file => !file || typeof file.name !== "string" || !(file.content instanceof Uint8Array))) throw new Error("导入文件内容无效");
    if (files.length > 1000 || files.reduce((n, f) => n + f.content.byteLength, 0) > 50 * 1024 * 1024) throw new Error("本批次上限1000文件、50 MiB，请分批导入");
    const base = `${roots.inbox}/导入-${stamp}`;
    for (const file of files) {
     if (!(file.content instanceof Uint8Array)) throw new Error("导入文件内容无效");
     const relative = validateVaultRelativePath(file.name); const path = `${base}/原件/${relative}`; const standardPath = `${base}/标准内容/${relative}.md`;
     await create(path, file.content);
     const ext = relative.split(".").pop()?.toLowerCase() ?? "";
     if (["txt", "md", "json", "csv"].includes(ext)) {
      let text: string;
      try { text = convertBasicFormat(decoder.decode(file.content), ext, "md"); }
      catch { warnings.push(`${relative}：计划保留原件，标准文本无法生成，需要复核。`); continue; }
      // Imported frontmatter remains source content, never privileged identity metadata.
      await create(standardPath, note(relative.replace(/\.md$/i, ""), text, date));
     } else if (!MEDIA.has(ext)) warnings.push(`${relative}：保留原件；当前未配置该格式的内容解析器。`);
    }
    message = `导入 ${files.length} 个原始文件，生成 ${changes.length} 个目标文件`; warnings.push("本地导入按文件类型处理；语义分类与身份推断不会自动运行。"); break;
   }
   case "library.organize": {
    const source = value(input, "path"); const destination = value(input, "destination");
    if (!source || !destination) throw new Error("请选择来源文件和目标模块目录");
    const targetRoot = this.path(destination);
    if (!Object.values(roots).includes(targetRoot) || targetRoot === roots.identity) throw new Error("请选择已配置的数据模块，身份通过专用入口处理");
    const content = await read(source);
    await create(`${targetRoot}/${leafName(source.split("/").pop() ?? "资料")}`, content);
    message = "创建分类副本，保留来源文件和既有链接";
    warnings.push("此操作不删除原件；分类副本不会自动取代原始来源。"); break;
   }
   case "library.archive": {
    const path = value(input, "path"); if (!path || !path.endsWith(".md")) throw new Error("请选择一个Markdown文件");
    if (path.startsWith(`${roots.identity}/`)) throw new Error("身份文件不通过通用归档命令修改");
    await update(path, text => setStatus(text, "archived")); message = "将选定笔记标记为已归档，保留位置和引用"; break;
   }
   case "library.export": case "library.backup": {
    if (!value(input, "paths", value(input, "path"))) throw new Error("请明确选择要打包的文件或模块目录");
    const files = selection(); if (!files.length) throw new Error("所选范围没有可打包文件");
    if (files.length > 1000 || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) throw new Error("本包上限1000文件、50 MiB，请分批选择");
    const packed = []; for (const file of files) packed.push(encodeDataPackageFile(file.path, await read(file.path)));
    await create(`${roots.output}/资料包-${stamp}.json`, serializeDataPackage(packed));
    message = `打包选定的 ${files.length} 个文件`;
    warnings.push("仅包含明确选择的数据范围；不含凭据、插件程序和未选择资料。该数据包未加密，请按其内容保护。"); break;
   }
   case "library.restore": {
    const files = input.files as ModuleImportFile[] | undefined;
    if (files !== undefined && (!Array.isArray(files) || files.length !== 1 || !(files[0]?.content instanceof Uint8Array))) throw new Error("每次请选择一个TALOS资料包");
    if (files?.[0] && files[0].content.byteLength > 80 * 1024 * 1024) throw new Error("资料包超过80 MiB，请分批恢复");
    const serialized = files?.[0]?.content ? decoder.decode(files[0].content) : value(input, "content");
    if (!serialized) throw new Error("请选择一个TALOS资料包");
    const pack = parseDataPackage(serialized);
    const base = `${roots.inbox}/恢复-${stamp}`;
    for (const file of pack.files) await create(`${base}/${validateVaultRelativePath(file.path)}`, decodeDataPackageFile(file));
    message = `将 ${pack.files.length} 个文件恢复到新目录`; warnings.push("不覆盖现有模块；核对恢复结果后再选择整理。"); break;
   }
   case "media.browse": case "media.info": {
    const files = selection().filter(f => MEDIA.has(f.extension.toLowerCase())); paths.push(...files.map(f => f.path));
    message = `${files.length} 个媒体文件`; resultText = files.map(f => `${f.path} · ${f.extension} · ${f.size} bytes`).join("\n"); break;
   }
   case "convert.inspect": {
    const files = selection(); message = `${files.length} 个选定文件`;
    resultText = files.map(f => `${f.path}：${getConversionSupport(f.extension, "md").supported ? "基础文本转换可用" : "原件可保留；需要格式解析器"}`).join("\n"); break;
   }
   case "convert.convert": {
    const path = value(input, "path", value(input, "source")); if (!path) throw new Error("请选择要转换的文件");
    const from = path.split(".").pop()?.toLowerCase() ?? ""; const to = value(input, "format", value(input, "targetFormat", value(input, "target", "md"))).toLowerCase().replace(/^\./, "");
    if (!getConversionSupport(from, to).supported) throw new Error("暂不支持此格式转换，原件未改变");
    const result = convertBasicFormat(decoder.decode(await read(path)), from, to);
    const name = leafName(path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "转换");
    await create(`${roots.output}/${name}-${stamp}.${to}`, result); message = "转换为新文件，原件保留"; break;
   }
   case "flow.morning": case "flow.review": case "flow.weekly": {
    const days = actionId === "flow.weekly" ? 7 : 1;
    const files = this.files().filter(f => f.mtime >= now.getTime() - days * 86_400_000);
    paths.push(...files.slice(0, 100).map(f => f.path)); message = `${days}天内 ${files.length} 个文件变化`;
    resultText = ["这是文件活动摘要，不等于工作已完成。", ...paths, "\n用户本轮提供：", value(input, "content", "待补充"), "\n待确认：实际成果、未完成事项、下一步。"].join("\n");
    if (actionId !== "flow.morning") {
     const reportPath = `${roots.logs}/复盘草稿-${stamp}.md`;
     await create(reportPath, note("活动复盘草稿", resultText, date, "daily-note"));
     paths.splice(paths.indexOf(reportPath), 1); paths.unshift(reportPath);
    }
    warnings.push("未自动修改项目完成状态或晋升身份；此处仅汇总本地文件活动。"); break;
   }
   case "flow.cycle": {
    if (!roots.system) throw new Error("系统工作记忆目录未配置，无法执行可接续的本地闭环");
    const source = this.path(value(input, "path"));
    if (!source.startsWith(`${roots.inbox}/`)) throw new Error("请选择收件箱中的来源文件");
    const extension = source.split(".").pop()?.toLowerCase() ?? "";
    if (!["md", "txt", "json", "csv"].includes(extension)) throw new Error("本地闭环仅支持 Markdown、TXT、JSON 和 CSV 来源");
    const confirmedMemory = value(input, "content");
    if (!confirmedMemory || encoder.encode(confirmedMemory).byteLength > 4096) throw new Error("请填写不超过4 KiB的用户确认记忆");
    const memoryKind = value(input, "memory_kind", "事实");
    if (memoryKind !== "事实" && memoryKind !== "明确偏好") throw new Error("请选择有效的记忆类型");
    const original = await read(source);
    if (original.byteLength > 2 * 1024 * 1024) throw new Error("本地闭环来源上限为2 MiB，请分批处理");
    const normalized = convertBasicFormat(decoder.decode(original), extension, "md");
    const sourceName = leafName(source.split("/").pop() ?? "资料");
    const originalPath = `${roots.assets}/入库-${stamp}/原件/${sourceName}`;
    const documentPath = `${roots.assets}/入库-${stamp}/标准内容.md`;
    const indexPath = `${roots.insights}/资料索引-${stamp}.json`;
    const maintenancePath = `${roots.logs}/维护检查-${stamp}.md`;
    const receiptPath = `${roots.output}/本地资料闭环-${stamp}.md`;
    const memoryPath = `${roots.system}/working-memory/daily/${date}.md`;
    const stagingPath = `${roots.system}/working-memory/candidates-staging.md`;
    const sourceState = extension === "md" ? frontmatterState(decoder.decode(original)) : "not-markdown";
    const memoryBlock = `\n\n## 用户确认的记忆 ${stamp}\n类型：${memoryKind}\n来源文件：${source}\n关联资料：${documentPath}\n\n${confirmedMemory}\n`;
    await create(originalPath, original);
    await create(documentPath, `---\ntype: "source-document"\ndate: ${date}\nsource: ${yamlString(source)}\n---\n\n# ${sourceName.replace(/[\r\n]/g, " ")}\n\n${normalized}\n`);
    await create(indexPath, `${JSON.stringify({ schema: "talos.local-text-index", version: 1, recorded_at: now.toISOString(), source_path: source, document_path: documentPath, text: normalized }, null, 2)}\n`);
    if (await this.host.exists(memoryPath)) await update(memoryPath, text => `${text}${memoryBlock}`);
    else await create(memoryPath, `---\ntype: "daily-memory"\ndate: ${date}\n---\n\n# 每日记忆 · ${date}${memoryBlock}`);
    if (memoryKind === "明确偏好") {
     const stagingBlock = `\n\n## 用户明确表达 ${stamp}\n来源文件：${source}\n原话：${confirmedMemory}\n状态：待偏好消化；未写入正式个人档案。\n`;
     if (await this.host.exists(stagingPath)) await update(stagingPath, text => `${text}${stagingBlock}`);
     else await create(stagingPath, `# 显式表达暂存${stagingBlock}`);
    }
    const maintenance = `来源文件：${source}\n原文格式：${extension}\n原始字节数：${original.byteLength}\n元数据检查：${sourceState === "present" ? "已存在" : sourceState === "missing" ? "来源缺少元数据，原文未修改" : sourceState === "manual" ? "来源元数据需人工核对，原文未修改" : "非 Markdown 来源；标准内容已生成元数据"}\n标准内容：${documentPath}\n索引：${indexPath}\n`;
    await create(maintenancePath, note("本地资料维护检查", maintenance, date, "daily-note"));
    await create(receiptPath, note("本地资料子链收据", `## 入库\n${originalPath}\n${documentPath}\n\n## 索引\n${indexPath}\n\n## 用户确认的记忆\n${memoryPath}\n${memoryKind === "明确偏好" ? `偏好暂存：${stagingPath}\n` : "本轮无偏好候选，未运行偏好消化。\n"}\n## 维护检查\n${maintenancePath}\n\n## 来源\n${source}\n\n## 接续边界\n本清单记录本次目标；是否全部完成以实际文件和 TALOS 任务状态为准。重复判定、关系、偏好消化与全库语义维护仍需本机智能体工作流复核。\n`, date, "workflow-receipt"));
    paths.splice(0, paths.length, receiptPath, originalPath, documentPath, indexPath, memoryPath, ...(memoryKind === "明确偏好" ? [stagingPath] : []), maintenancePath);
    details.push(`入库原件：${originalPath}`, `标准内容：${documentPath}`, `检索索引：${indexPath}`, `每日记忆：${memoryPath}`, ...(memoryKind === "明确偏好" ? [`偏好暂存：${stagingPath}`] : []), `维护检查：${maintenancePath}`, `执行收据：${receiptPath}`);
    message = "预览入库、索引、确认记忆、维护检查和收据的实际写入";
    warnings.push("这是 C10 的单文件确定性子链；重复判定、关系、偏好消化与全库语义维护请继续使用本机智能体工作流。不会自动晋升正式偏好或项目状态。");
    warnings.push("本机 Obsidian 不支持原子条件删除；中断后新建文件会保留供核对，已有文本改动会按原内容条件恢复。");
    break;
   }
   case "system.check": case "system.repair": {
    const scope = actionId === "system.repair" && value(input, "scope") ? this.path(value(input, "scope")) : "";
    const files = this.files().filter(f => f.extension.toLowerCase() === "md" && (!roots.system || !f.path.startsWith(`${roots.system}/working-memory/`)) && (!scope || f.path === scope || f.path.startsWith(`${scope}/`))).sort((a, b) => a.path.localeCompare(b.path));
    if (scope && !files.length) throw new Error("选定范围没有可检查的 Markdown 文件");
    let missing = 0; let scanned = 0; let repaired = 0; let deferred = 0;
    for (const file of files.slice(0, 500)) {
     if (file.size > 2 * 1024 * 1024 || isReadme(file.path)) continue;
     const text = decoder.decode(await read(file.path)); scanned++;
     const state = frontmatterState(text);
     if (state === "present") continue;
     missing++;
     const protectedMemory = Boolean(roots.system) && file.path.startsWith(`${roots.system}/working-memory/`);
     if (actionId === "system.repair" && state === "missing" && !file.path.startsWith(`${roots.identity}/`) && !protectedMemory && repaired < 20) {
      await update(file.path, original => `---\n---\n\n${original}`);
      repaired++; details.push(`${file.path}：将添加空元数据区块，正文保持原样`);
     } else {
      if (actionId === "system.repair") deferred++;
      details.push(`${file.path}：${state === "manual" ? "元数据不完整或含 BOM，需人工核对" : file.path.startsWith(`${roots.identity}/`) ? "身份文件需通过专用入口处理" : protectedMemory ? "工作记忆需在记忆流程中处理" : actionId === "system.repair" ? "本批修复上限20个，留待下次" : "缺少元数据"}`);
     }
    }
    message = actionId === "system.repair" ? `检查 ${scanned} 个 Markdown，发现 ${missing} 个元数据缺口；本次预览修复 ${repaired} 个，保留 ${deferred} 个待处理` : `检查 ${scanned} 个Markdown，发现 ${missing} 个元数据缺口`;
    if (files.length > scanned) warnings.push("部分文件未检查，请缩小范围或检查大文件。");
    if (actionId === "system.repair") warnings.push("仅添加空元数据区块，不推断标题、状态或身份；所有正文内容保留。预览后如文件改变，执行会拒绝写入。");
    break;
   }
   default: throw new Error(actionId === "media.ocr" || actionId === "media.transcribe" ? "当前尚未配置本地识别引擎，未执行识别，也未发送媒体文件。" : "该动作尚未接入本地执行器");
  }
  if (this.rootsKey() !== rootsKey) throw new Error("数据模块映射发生变化，请重新生成计划");
  const plan: ModuleCommandPlan = freezePlan({ actionId, summary: message, details, changes, readPaths: [...new Set(readPaths)], result: { message, paths, warnings, ...(resultText !== undefined ? { text: resultText } : {}) } });
  this.prepared.set(plan, { snapshot: clonePlan(plan), reads, roots: rootsKey, state: "prepared" }); return plan;
 }
 private stored(plan: ModuleCommandPlan): PreparedPlan {
  const stored = this.prepared.get(plan);
  if (!stored) throw new Error("未知执行计划");
  // Frozen object structure plus private byte copies prevents typed-array tampering.
  if (plan.changes.some((change, index) => {
   const original = stored.snapshot.changes[index];
   return !equal(change.after, original.after) || (change.before === null) !== (original.before === null)
    || (change.before !== null && original.before !== null && !equal(change.before, original.before));
  })) throw new Error("执行计划内容已被修改，请重新预览");
  return stored;
 }
 private checkRoots(stored: PreparedPlan): void {
  if (stored.roots !== this.rootsKey()) throw new Error("数据模块映射发生变化，请重新生成计划");
 }
 private async current(path: string): Promise<Uint8Array | null> {
  await this.host.assertPath(this.path(path), false);
  return await this.host.exists(path) ? new Uint8Array(await this.host.read(path)) : null;
 }
 private matches(current: Uint8Array | null, expected: Uint8Array | null): boolean {
  return current === null || expected === null ? current === expected : equal(current, expected);
 }
 private async rollback(stored: PreparedPlan, changes: readonly ModuleMutation[], signal?: AbortSignal): Promise<number> {
  let failed = 0;
  for (const change of [...changes].reverse()) {
   try {
    checkCancelled(signal); this.checkRoots(stored);
    this.writePath(change.path, stored.snapshot.actionId);
    await this.host.assertPath(change.path, true);
    const current = await this.current(change.path);
    if (this.matches(current, change.before)) continue;
    // Preserve intervening user edits, including partial writes of uncertain origin.
    if (!this.matches(current, change.after)) throw new Error("恢复目标已有其他变化");
    checkCancelled(signal); this.checkRoots(stored);
    try {
     if (change.before === null) await this.host.remove(change.path, new Uint8Array(change.after));
     else await this.host.write(change.path, new Uint8Array(change.before), new Uint8Array(change.after));
    } catch {
     // A host may throw after persisting; actual bytes determine recovery success.
     if (!this.matches(await this.current(change.path), change.before)) throw new Error("恢复未完成");
    }
    if (!this.matches(await this.current(change.path), change.before)) throw new Error("恢复校验失败");
   } catch { failed++; }
  }
  return failed;
 }
 async apply(plan: ModuleCommandPlan, signal: AbortSignal): Promise<ModuleCommandPlan["result"]> {
  const stored = this.stored(plan);
  if (stored.state !== "prepared") throw new Error("该计划已执行、取消或失效，请重新预览");
  // Reserve synchronously, before any await, so concurrent calls cannot both run.
  stored.state = "applying";
  const attempted: ModuleMutation[] = [];
  let preflightComplete = false;
  try {
   checkCancelled(signal); this.checkRoots(stored);
   for (const [path, expected] of stored.reads) {
    checkCancelled(signal);
    if (!this.matches(await this.current(path), expected)) throw new Error("预览后来源文件发生变化，请重新生成计划");
   }
   for (const change of stored.snapshot.changes) {
    checkCancelled(signal); this.writePath(change.path, stored.snapshot.actionId);
    await this.host.assertPath(change.path, true);
    if (!this.matches(await this.current(change.path), change.before)) throw new Error("预览后目标文件发生变化，请重新生成计划");
   }
   checkCancelled(signal); this.checkRoots(stored); preflightComplete = true;
   for (const change of stored.snapshot.changes) {
    checkCancelled(signal); this.checkRoots(stored);
    await this.host.assertPath(this.writePath(change.path, stored.snapshot.actionId), true);
    checkCancelled(signal); this.checkRoots(stored);
    // Track before awaiting: a failed write can already have persisted content.
    attempted.push(change);
    await this.host.write(change.path, new Uint8Array(change.after), change.before === null ? null : new Uint8Array(change.before));
    if (!this.matches(await this.current(change.path), change.after)) throw new Error("写入后校验失败");
    checkCancelled(signal);
   }
   stored.state = "applied";
   return clonePlan(stored.snapshot).result;
  } catch {
   stored.state = signal.aborted ? "cancelled" : "failed";
   const failed = await this.rollback(stored, attempted);
   if (failed) throw new Error(`操作未完成，${failed} 个目标存在变化或恢复失败，未覆盖后续修改，请保留现场。`);
   if (signal.aborted) throw new Error(attempted.length ? "已取消，已恢复本批次写入。" : "已取消，未写入文件。");
   throw new Error(preflightComplete ? "执行失败，已恢复本批次写入。" : "预览后文件、路径或模块配置发生变化，未写入；请重新预览。");
  }
 }
 /** Session-only undo; unavailable after service/app restart. Never overwrites later edits. */
 async undo(plan: ModuleCommandPlan, signal?: AbortSignal): Promise<ModuleCommandPlan["result"]> {
  const stored = this.stored(plan);
  if ((stored.state !== "applied" && stored.state !== "undo-failed") || !stored.snapshot.changes.length) throw new Error("该计划没有可撤销的已完成写入");
  stored.state = "undoing";
  try {
   checkCancelled(signal); this.checkRoots(stored);
   // Detect all known conflicts before reverting any file.
   for (const change of stored.snapshot.changes) {
    checkCancelled(signal); this.writePath(change.path, stored.snapshot.actionId);
    const current = await this.current(change.path);
    if (!this.matches(current, change.after) && !this.matches(current, change.before)) throw new Error("文件在执行后已有修改，撤销未覆盖这些修改。");
   }
   const failed = await this.rollback(stored, stored.snapshot.changes, signal);
   if (failed) throw new Error(`撤销未完成，${failed} 个目标仍需核对；未覆盖后续修改。`);
   stored.state = "undone";
   return { message: "已恢复本次操作前的文件内容", paths: stored.snapshot.changes.filter(change => change.before !== null).map(change => change.path), warnings: ["本次恢复使用当前会话内存快照，不是跨重启持久备份。"] };
  } catch {
   stored.state = "undo-failed";
   throw new Error(signal?.aborted ? "撤销已取消；请核对已恢复范围后重试。" : "撤销未完成，目标可能已有其他修改；已保留后续修改，请核对后重试。");
  }
 }
}
