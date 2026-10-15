# 桌面版发布

桌面 CI 使用 Windows runner 执行前端测试、Rust 测试和 `npm run build:desktop`。构建出的 NSIS `.exe` 与 MSI `.msi` 会作为 GitHub Actions artifact 保存，普通 CI artifact 保留 14 天。

发布前先在同一个提交中同步更新这两个版本字段：

- `package.json` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`

然后创建并推送符合 `vMAJOR.MINOR.PATCH` 的 tag：

```powershell
git tag v0.1.1
git push origin main v0.1.1
```

`Desktop Release` 会重新测试、构建安装包，并把 `.exe` 和 `.msi` 发布到对应的 GitHub Release。也可以在 Actions 页面手动运行该 workflow，输入一个已有的版本 tag。

当前没有配置 Tauri 签名密钥，安装包会以未签名方式发布。需要签名时，在仓库 Secrets 中配置 Tauri 官方签名变量，再在 workflow 中传给构建步骤。
