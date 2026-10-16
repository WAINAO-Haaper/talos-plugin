/**
 * 预览模型：把 markdownToContentState 的输出整理成「可渲染」的纯数据结构。
 *
 * 预览的保真原则：不做第二套 markdown 解析，直接消费发布链路的 content_state——
 * 预览里看到的降级（行内代码变普通文本、嵌套列表被丢弃、表格/代码块退化为原文）
 * 就是真实发布后的效果。
 *
 * 本文件与 previewHtml.ts 均与框架无关（无 DOM、无 React），Node 里可直接测试；
 * 消费方：Chrome 插件（React 壳）、Obsidian 插件、独立 Web 页面。
 */

import { collectImageSources, markdownToContentState } from './contentState.js';
import type { ContentBlock, EntityValue, EntityRange, InlineStyleRange } from './types.js';

export interface PreviewModel {
  /** 正文第一个 # 剥离出的标题；发布时若上层带 title 会优先用上层的。 */
  derivedTitle?: string;
  blocks: ContentBlock[];
  /** entity_map（X 的数组形态）→ Map，渲染时 O(1) 取实体。 */
  entities: Map<number, EntityValue>;
}

/**
 * 与发布完全同一条转换路径；唯一差别：media_id 用图片 src 本身占位，
 * 保证图片不被 skip，渲染时可用 media_id（== src）反查图片地址。
 */
export function buildPreviewModel(markdown: string): PreviewModel {
  const mediaIdBySrc = new Map(collectImageSources(markdown).map((src) => [src, src]));
  const { contentState, title } = markdownToContentState(markdown, mediaIdBySrc);
  return {
    derivedTitle: title,
    blocks: contentState.blocks,
    entities: new Map(contentState.entity_map.map((e) => [e.key, e.value])),
  };
}

/** 一段样式均匀的文字。entityKey 指向覆盖这段文字的（LINK）实体。 */
export interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  entityKey?: number;
}

/**
 * 把一个 block 的 text 按 inline_style_ranges / entity_ranges 切成样式均匀的段。
 *
 * 边界集切分：收集所有区间端点作为切点，相邻切点之间的区间内覆盖必然均匀
 * （不会有区间端点落在其内部），逐段判定覆盖即可。offset/length 是 UTF-16
 * code unit（content_state 的契约），与 String.prototype.slice 同坐标系，
 * 切点全部来自同一字符串上算出的区间端点，不会切开代理对。
 */
export function segmentText(
  text: string,
  styles: InlineStyleRange[],
  entities: EntityRange[],
): Segment[] {
  if (text.length === 0) return [];

  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const cuts = new Set<number>([0, text.length]);
  for (const r of styles) {
    cuts.add(clamp(r.offset));
    cuts.add(clamp(r.offset + r.length));
  }
  for (const r of entities) {
    cuts.add(clamp(r.offset));
    cuts.add(clamp(r.offset + r.length));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= b) continue;
    const covers = (r: { offset: number; length: number }) => r.offset <= a && b <= r.offset + r.length;
    segments.push({
      text: text.slice(a, b),
      bold: styles.some((r) => r.style === 'Bold' && covers(r)),
      italic: styles.some((r) => r.style === 'Italic' && covers(r)),
      strikethrough: styles.some((r) => r.style === 'Strikethrough' && covers(r)),
      entityKey: entities.find(covers)?.key,
    });
  }

  // 合并相邻同样式段，减少输出碎片。
  const merged: Segment[] = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.strikethrough === s.strikethrough &&
      prev.entityKey === s.entityKey
    ) {
      prev.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** 渲染用的块分组：连续同型列表项归为一组（对应一个 <ul>/<ol>），其余逐块。 */
export type BlockGroup =
  | { kind: 'single'; block: ContentBlock }
  | { kind: 'list'; ordered: boolean; items: ContentBlock[] };

export function groupBlocks(blocks: ContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of blocks) {
    const listOrdered =
      block.type === 'ordered-list-item' ? true : block.type === 'unordered-list-item' ? false : undefined;
    if (listOrdered === undefined) {
      groups.push({ kind: 'single', block });
      continue;
    }
    const prev = groups[groups.length - 1];
    if (prev && prev.kind === 'list' && prev.ordered === listOrdered) {
      prev.items.push(block);
    } else {
      groups.push({ kind: 'list', ordered: listOrdered, items: [block] });
    }
  }
  return groups;
}
