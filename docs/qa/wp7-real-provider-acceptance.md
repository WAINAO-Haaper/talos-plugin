# WP7 真实 Provider 验收

- 日期：2026-07-25（Asia/Shanghai）
- 状态：NOT STARTED
- 原因：真实 Provider、SecretStorage 凭证、麦克风和外部网络尚未获得单独授权

## 授权前禁止执行

- 不读取、复制、打印或写入任何 SecretStorage 值。
- 不调用真实云端 Provider、CLI Provider、网络 ASR 或网络 TTS。
- 不请求麦克风权限。
- 不在部署 Vault 执行 B/C 类写入。
- 不把密钥、敏感请求头、私人正文或 `.talos/private/` 写入验收文档。

## 获得授权后的正式矩阵

1. 真实云端 Provider 完成一次全库问答，记录 Provider ID、时间、非敏感读取范围
   和发送审计。
2. 验证密钥、凭证、敏感请求头和永久禁区零外发。
3. 在隔离测试 Vault 完成一次真实低风险动作。
4. 完成一次高风险提案、查看 diff、独立批准、写入、撤销和前后差异检查。
5. 完成独立语音问答、打断与点击说话降级。
6. 完成 Provider 切换或人工模型复核，并确认工具调用不重复执行。

## 通过条件

每一项必须保存 Provider、时间、读取范围、修改范围、审批、恢复点和最终结果，
且文档中不得出现任何密钥值。任一项失败时 Task 16 保持候选状态，不修改
`manifest.json`、`versions.json` 或发行元数据。
