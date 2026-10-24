# 桌面版发布

桌面 CI 使用 Windows runner 执行前端测试、Rust 测试和 `npm run build:desktop`。构建出的 NSIS `.exe` 与 MSI `.msi` 会作为 GitHub Actions artifact 保存，普通 CI artifact 保留 14 天。

发布前先在同一个提交中同步更新应用版本。推荐使用脚本，它会同时更新 `package.json`、`package-lock.json`、Tauri 配置和 Cargo 的 `Cargo.toml`/`Cargo.lock`：

```powershell
npm run version:set -- 0.1.1
```

确认版本和构建通过后提交版本变更。版本提交应包含版本文件和本次要发布的功能代码；不要只提交 tag：

```powershell
git status
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock scripts/set-version.mjs .github/workflows/release.yml docs/RELEASE.md
git commit -m "chore: release v0.1.1"
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin main
git push origin v0.1.1
```

推送 `vMAJOR.MINOR.PATCH` tag 后，GitHub Actions 会自动运行 `.github/workflows/release.yml`。它会重新测试、构建安装包，并把 `.exe` 和 `.msi` 发布到对应的 GitHub Release。普通推送到 `main` 或 Pull Request 只运行 `ci.yml`，用于测试和构建 artifact，不创建正式 Release。也可以在 Actions 页面手动运行 Release workflow，输入一个已有的版本 tag。

仓库需要启用 Actions，并允许 workflow 使用 `contents: write` 发布 GitHub Release。当前没有配置 Tauri 签名密钥，安装包会以未签名方式发布。需要签名时，在仓库 Secrets 中配置 Tauri 官方签名变量，再在 workflow 中传给构建步骤。
