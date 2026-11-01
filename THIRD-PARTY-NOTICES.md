# Third-party notices

> 本文件界定 TALOS 自有代码与第三方技术的许可边界。TALOS 自有部分采用根目录 `LICENSE` 的 TALOS Personal Use Source License 1.0：个人非商业用途开放，商业使用须书面授权；下列第三方材料继续受各自许可证和服务条款约束。

## 分发要求

任何对外发布、销售或交付的 TALOS 安装包必须同时包含：

- `LICENSE`
- `THIRD-PARTY-NOTICES.md`
- `THIRD-PARTY-LICENSES.txt`

`THIRD-PARTY-LICENSES.txt` 由 `npm run licenses:generate` 根据生产依赖自动生成；`npm run build` 会拒绝使用过期清单构建。

## TalosBall 0.3.0 runtime attribution

Plugin 语音中心视觉嵌入 TalosBall 0.3.0。产品目录、API 与运行时标识统一为 TalosBall；几何、32 态数据、SVG renderer 与动画参数保持授权固定来源的确定性等价。

- Local runtime: `src/quyuan/talos-ball/runtime/`
- Source attribution and license materials: `src/quyuan/talos-ball/runtime/vendor/talos-ball-runtime/`
- Fixed source repository: `https://github.com/sam70361/emotion-ball`
- Fixed source commit: `b406eeb20a1b1ae0084d4006e77cc74e28be009d`
- Verification: 32 states × 9 timestamps, 288 deterministic pose traces

TalosBall 包装、Plugin 状态适配和生命周期代码属于 TALOS 新增层；来源几何、状态数据、renderer 与 animation engine 不声明为独立原创。对外发布仍受项目现有 rights/legal 与 Release gates 约束。

## 语音与本地媒体识别

实时语音由现行 Qwen Realtime 服务接口提供，受服务提供方条款约束。旧 Sherpa-ONNX
浏览器 ASR 和 ONNX Runtime 文本快照已从当前源码移除。为保持既有部署资产完整，
部署快照仍保留原有本地语音模型、运行时与其附带的许可证；当前语音主链不使用它们。
本地媒体识别继续使用用户明确配置的 Whisper CLI、模型和 FFmpeg；这些外部资产
不由本插件打包，用户应按各自许可证使用。历史部署快照保留其原归属与许可证。

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


## Native draft publishing — SerenaPost 1.1.5

Source: https://github.com/SerenaMugua/serena-post/tree/1.1.5 (`5b4cb53d0545154ef0b61c1d257e444c3891acf8`). Source fingerprints and local changes: `vendor/serena-post/SOURCE.md`. No Serena avatar or brand image is included. The following MIT notices remain applicable to the borrowed modules and distributed bundle.

```text
MIT License

Copyright (c) 2026 Serena 木瓜

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

# Third-party notices

## WeChatPB

Source: https://github.com/Kianzzz/wechatPB (author: zhouxing / Kianzzz)

```
MIT License

Copyright (c) 2025-2026

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

## Kaitox (@kaitox/relay-protocol, @kaitox/x-article, @kaitox/relay, Kaitox for Obsidian)

Source: https://github.com/kuangjiajia/kaitox-toolkit — vendored under vendor/kaitox/ (relay image resizing rewritten to use canvas; pidfile removed).

```
MIT License

Copyright (c) 2026 kaitox (https://kaitox.ai)

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

## marked

https://github.com/markedjs/marked — MIT License, bundled in main.js.


Additional production packages: `marked` (9.1.6), `marked18` (npm alias for marked 18.0.14), `postcss` (8.5.19), `https-proxy-agent` (7.0.6), `socks-proxy-agent` (8.0.5). Full package licenses are generated in `THIRD-PARTY-LICENSES.txt`.
