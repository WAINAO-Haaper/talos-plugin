# WP7 真实 Provider 验收

- 初始模板日期：2026-07-25（Asia/Shanghai）
- 新鲜度复核：2026-08-09（Asia/Shanghai）
- 状态：PARTIAL
- 结论：受控真实 CLI 只读问答、metadata-only 外发审计、统一外发失败关闭和
  OpenAI-compatible 最小连接已有脱敏证据；完整生产矩阵仍未通过

## 已验证子项

- 隔离合成 Vault 的受控真实 CLI 只读问答通过，记录了非敏感读取范围和
  metadata-only 外发审计，源文件保持不变。
- 统一 AI 控制台已接入发送前 egress 预检与标准审计存储；失败时关闭外发。
- OpenAI-compatible Provider 的端点规范化和一次最小连接通过；未发送 Vault 正文，
  未读取或输出凭证值。

这些子项只足以把 G1 维持为 `partial`。它们不代表至少两类生产 Provider 的完整
配置、替换和失败关闭已经验收，也不关闭真实语音、写入、回滚或商业发布门。

## 授权前禁止执行

- 不读取、复制、打印或写入任何 SecretStorage 值。
- 不调用真实云端 Provider、CLI Provider、网络 ASR 或网络 TTS。
- 不请求麦克风权限。
- 不在部署 Vault 执行 B/C 类写入。
- 不把密钥、敏感请求头、私人正文或 `.talos/private/` 写入验收文档。

## 仍待完成的正式矩阵

1. 真实云端 Provider 完成一次全库问答，记录 Provider ID、时间、非敏感读取范围
   和发送审计。
2. 验证密钥、凭证、敏感请求头和永久禁区零外发。
3. 在隔离测试 Vault 完成一次真实低风险动作。
4. 完成一次高风险提案、查看 diff、独立批准、写入、撤销和前后差异检查。
5. 完成独立语音问答、打断与点击说话降级。
6. 完成 Provider 切换或人工模型复核，并确认工具调用不重复执行。

## 通过条件

每一项必须保存 Provider、时间、读取范围、修改范围、审批、恢复点和最终结果，
且文档中不得出现任何密钥值。任一项未完成或失败时 Task 16 与 G1 保持候选/
`partial` 状态，不得把 `manifest.json`、`versions.json` 或发行元数据改成正式发布。
