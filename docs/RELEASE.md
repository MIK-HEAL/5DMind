# 桌面和移动版发布

桌面 CI 使用 Windows runner 执行前端测试、Rust 测试和 `npm run build:desktop`。Release workflow 还会使用 Ubuntu runner 初始化 Tauri Android 目标，构建 arm64 APK 和 AAB，并把 Windows 安装包、Android 安装包一起上传到 GitHub Release。普通 CI artifact 保留 14 天。

移动端本地构建需要先安装 Android Studio、Android SDK、NDK 和 Java 21，然后初始化 Android 目标：

`tauri` 需要通过 `ANDROID_HOME`/`ANDROID_SDK_ROOT` 找到 SDK，并通过 `NDK_HOME` 找到 NDK；如果 Android Studio 安装在自定义位置，请先在当前终端设置这些变量。

```powershell
$env:ANDROID_HOME = "C:\path\to\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = "C:\path\to\Android\Sdk\ndk\27.0.12077973"
npx tauri android init
npm run dev:android
npm run build:android
```

Android 构建默认生成 arm64 APK 和 AAB。iOS 需要 macOS、Xcode 和 Apple 签名配置；在 macOS 上初始化后使用 `npm run dev:ios` 或 `npm run build:ios`。当前 GitHub Release 先自动发布 Android 包，iOS 发布需要补充 Apple Developer 签名 Secrets。

发布前先在同一个提交中同步更新应用版本。推荐使用脚本，它会同时更新 `package.json`、`package-lock.json`、Tauri 配置和 Cargo 的 `Cargo.toml`/`Cargo.lock`：

```powershell
npm run version:set -- 0.1.1
```

确认版本和构建通过后提交版本变更。版本提交应包含版本文件和本次要发布的功能代码；不要只提交 tag：

```powershell
git status
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/tauri.android.conf.json src-tauri/tauri.ios.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock scripts/set-version.mjs .github/workflows/release.yml docs/RELEASE.md README.md
git commit -m "chore: release v0.1.1"
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin main
git push origin v0.1.1
```

推送 `vMAJOR.MINOR.PATCH` tag 后，GitHub Actions 会自动运行 `.github/workflows/release.yml`。它会重新测试、构建 Windows 和 Android 安装包，并发布到对应的 GitHub Release。普通推送到 `main` 或 Pull Request 只运行 `ci.yml`，用于测试和构建 artifact，不创建正式 Release。也可以在 Actions 页面手动运行 Release workflow，输入一个已有的版本 tag。

仓库需要启用 Actions，并允许 workflow 使用 `contents: write` 发布 GitHub Release。当前没有配置 Tauri 签名密钥，安装包会以未签名方式发布。需要签名时，在仓库 Secrets 中配置 Tauri 官方签名变量，再在 workflow 中传给构建步骤。
