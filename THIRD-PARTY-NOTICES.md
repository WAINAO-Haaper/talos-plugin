# Third-party notices

> 本文件界定 TALOS 自有代码与第三方技术的许可边界。TALOS 自有部分采用根目录 `LICENSE` 的专有商业许可；下列第三方材料继续受各自许可证和服务条款约束。

## 分发要求

任何对外发布、销售或交付的 TALOS 安装包必须同时包含：

- `LICENSE`
- `THIRD-PARTY-NOTICES.md`
- `THIRD-PARTY-LICENSES.txt`

`THIRD-PARTY-LICENSES.txt` 由 `npm run licenses:generate` 根据生产依赖自动生成；`npm run build` 会拒绝使用过期清单构建。

## 可选本地语音运行时与模型

本地 ASR 使用构建时静态嵌入的 Sherpa-ONNX 浏览器封装、独立 Web Worker、固定 WASM
与中英双语流式 Zipformer int8 模型。运行时不联网；插件只读取安装目录的固定资产，并在
申请麦克风前逐文件校验字节数与 SHA-256。缺件或校验失败时失败关闭。

- Runtime: sherpa-onnx 1.13.6
- Runtime snapshot: `7c59b5225b857366f0a8c0cc1783ace8e9f193ac`
- Runtime license: Apache-2.0
- Embedded inference engine: ONNX Runtime 1.27.1, MIT
- Model: `csukuangfj/k2fsa-zipformer-bilingual-zh-en-t`
- Model revision: `e2382758de9a0219b4efe682b95af30b399db3b8`
- Model repository license declaration: Apache-2.0
- Complete asset hashes, attribution and bundled license texts:
  `src/quyuan/vendor/local-voice-runtime/NOTICE.md`

模型卡只把训练集描述为数万小时内部数据；因此当前集成可用于本地技术验收，但在商业发布
前仍须对训练数据来源披露与适用风险做独立复核。Silero VAD 仍维持独立失败关闭边界，未因
ASR 集成而自动引入第三方运行时或模型。

## Claudian

TALOS 的生产对话行为代码由 `src/agent-workbench/` 自主实现，不再包含 Claudian 的 runtime、会话、Provider、聊天、行内编辑、MCP 或 Subagent 实现。功能架构研究以 Claudian 最新源码提交 `d190786d11cc0b067475dcffbf8c334ee565d208` 为参照。

为保证已经验收的对话 UI 设计不发生视觉回归，`src/agent-workbench/ui/styles/` 保留了早期 Claudian MIT 样式基线及 `.claudian-*` 选择器作为纯视觉 ABI；这些选择器不代表运行时依赖。下列旧提交仅用于该既存视觉资产的许可证溯源，不是功能实现依据。

- Project: Claudian
- Visual asset origin: 2.0.25 / `9496e66a3877aa9993f73432d411b7cd682f4557`
- Latest architecture reference: `d190786d11cc0b067475dcffbf8c334ee565d208`
- Repository: https://github.com/YishenTu/claudian
- License: MIT

```text
MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Claude Agent SDK

TALOS 的 Claude CLI 通道使用 `@anthropic-ai/claude-agent-sdk`。

- Package: `@anthropic-ai/claude-agent-sdk`
- Version: 0.3.207
- Copyright: Anthropic PBC
- License model: 非开源许可证；使用受 Anthropic 法律协议约束
- Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Agent SDK terms: https://code.claude.com/docs/en/agent-sdk/overview
- Commercial terms: https://www.anthropic.com/legal/commercial-terms

商业交付边界：

1. Agent SDK 可用于向客户和最终用户提供产品能力，但必须遵守 Anthropic 商业条款、使用政策与支持地区规则。
2. 面向第三方客户的产品应使用 Claude Console API Key 或受支持云厂商凭证；不得代用户转接 Free/Pro/Max 的个人 OAuth/订阅凭证。
3. TALOS 不附送、出售或转移 Anthropic API Key，也不承诺 Claude 服务额度。客户应自行提供合法凭证，或另行签署符合 Anthropic 条款的托管服务协议。
4. 不使用 “Claude Code” 或 “Claude Code Agent” 作为 TALOS 产品品牌；界面仅把 “Claude” 作为可选模型/Provider 名称。

## Uiverse.io 按钮交互

屈原语音界面的紧凑操作按钮借鉴并改写了 Uiverse.io 社区作者 `gharsh11032000` 的按钮交互：深色胶囊底、底部上涌填色与 hover 摇动。TALOS 保留原作者标记，并将颜色、尺寸、禁用态、键盘聚焦、reduced-motion 与七主题语义重新接入本地 `tq-btn` 体系。

- Project: Uiverse Galaxy
- Contributor attribution: `gharsh11032000`
- Repository: https://github.com/uiverse-io/galaxy
- License: MIT

## Ma Shan Zheng 字体

屈原语音界面的状态主标题使用 Ma Shan Zheng 中文毛笔字体，并随插件本地分发，避免联网加载导致字体闪烁或失效。

- Project: Ma Shan Zheng
- Source: https://github.com/google/fonts/tree/main/ofl/mashanzheng
- Copyright: 2018 The Ma Shan Zheng Project Authors
- License: SIL Open Font License 1.1
- Bundled license: `MaShanZheng-OFL.txt`

适用许可为上文列出的 MIT License；本项目未改变其版权与许可归属。

## 直接运行时依赖

| Package | Version | License / terms |
|---|---:|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.207 | Anthropic legal agreements |
| `@codemirror/state` | 6.5.0 | MIT |
| `@codemirror/view` | 6.38.6 | MIT |
| `@modelcontextprotocol/sdk` | 1.29.0 | MIT |
| `smol-toml` | 1.7.0 | BSD-3-Clause |
| `tslib` | 2.8.1 | 0BSD |

上述依赖及其生产级传递依赖的完整许可证文本、版权声明与版本快照见 `THIRD-PARTY-LICENSES.txt`。当前清单由本地 lockfile 生成，共覆盖 108 个已安装生产包。

## 模型和外部服务

模型、CLI、MCP Server 与语音服务不是 TALOS 自有软件许可的一部分。使用者须分别遵守所选服务的最新条款：

- Anthropic / Claude: https://www.anthropic.com/legal/commercial-terms
- OpenAI / Codex: https://openai.com/policies/services-agreement/
- Obsidian: https://obsidian.md/license
- 其他 OpenCode、Pi、模型网关、MCP Server、千问、Edge TTS、ElevenLabs 等服务：以各自供应商条款为准

推荐商业模式为 BYOK（客户自带 API Key/CLI 账号）。若 TALOS 运营方统一付费并向客户提供模型额度，应在上线前单独确认对应供应商是否允许转售、托管或多租户使用。
