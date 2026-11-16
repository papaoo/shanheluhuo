# OldGold 简体中文 Android 版

此目录生成资源全部内置的 Android APK，默认简体中文。游戏从应用内的 `https://localhost` 加载，无需部署网站或首次联网下载素材。联网合作模式仍需要网络和相应服务。

## 安装与使用

将 `OldGold-zh-CN-0.12.5-1-release.apk` 传到安卓手机，用文件管理器打开并允许本次安装来源。安装后图标名称为 **OldGold 简体中文版**，建议横屏游玩。

- 最低安装版本：Android 7.0（API 24）。请保持 **Android System WebView / Chrome** 更新；打包代码使用 Chrome 85 语法目标，并补齐游戏实际依赖的 `Object.hasOwn` / `Array.at`。这些检查不等于已在所有旧系统上实测。
- 常见宽屏手机为主要使用场景；平板、折叠屏或系统强制竖屏时沿用游戏的响应式界面。
- 保留游戏原有的设备判断和自适应画质。中低端手机建议在游戏菜单使用 **画质：轻量**，大型聚落或拉远镜头仍可能增加负载。
- 存档保存在应用本地。切后台会尝试自动保存；手动存档仍然建议保留。系统返回键先关闭面板，在游戏顶层会确认保存并退出。
- 在存档界面导出 JSON，系统会让你选择保存位置；确认写入完成后才显示成功。可在游戏的导入入口恢复该文件。
- 使用同一签名的新版本覆盖安装可保留数据；**卸载应用或清除应用数据会删除本地存档**，请先导出备份。

中文版包名为 `ru.oldgold.zhcn`，可与作者的原版应用并存。它不会自动读取浏览器或原版应用的存档；迁移时需要从原位置导出，再在中文版导入。

## 构建

需要 Node.js 22 或更高版本、JDK 21、Android SDK（平台 36、platform-tools、构建工具），使用项目内 Gradle Wrapper。先在此目录执行 `npm ci`。根目录的 `npm run check`、`npm run test:i18n`、`npm run test:android` 用于回归；`npm run test:android:web` 检查打包后的网页内容。`npm run test:i18n:startup -- --web-root mobile/www` 刻意延迟加载，检查首屏不会提前显示俄文，同时保持英文、俄文选择有效。

Windows 示例：

```powershell
./mobile/build-android.ps1 -Configuration Release -SdkPath 'D:\Programs\SDK' -JavaHome 'D:\Program Files\Android\Android Studio\jbr'
```

需要网络代理时可加 `-ProxyHost 127.0.0.1 -ProxyPort <端口>`，仅作用于本次 Gradle 进程。脚本重建资源、执行 Capacitor 同步、编译签名 APK，并生成同名 `.sha256`。

签名配置默认位于用户目录 `.codex/signing/oldgold-zh-cn/signing.json`，含 `keystore`、`alias`、`storePassword`、`keyPassword` 四项；也可通过 `-SigningConfig` 指定。私钥及此配置应单独备份，不进入 Git 或分享包。以后覆盖升级必须使用同一私钥，且应递增版本号。

使用 `-Configuration Debug` 可生成供 WebView 调试的版本；最终交付使用 Release。提供私有签名配置时，两者用同一个签名，便于检验覆盖安装的数据保留。

资源构建说明见 [WEB_BUNDLE.zh-CN.md](../docs/localization/WEB_BUNDLE.zh-CN.md)。验收范围、性能和局限以本次交付的验收报告为准；模拟器功能检查不能推断真机帧率、发热或耗电。
