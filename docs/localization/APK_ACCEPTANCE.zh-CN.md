# Android 简体中文离线版验收记录

日期：2026-11-16。发布代码：`48674bfb9c6e0d9f5c9f9dd97aef52813f12b8c9`，分支 `codex/android-zh-offline`。浏览器汉化起点：`6d103990cbdf1fac91fe8656c8a39a5e473e6fca`。

## 安装包

- 文件：`mobile/OldGold-zh-CN-0.12.5-1-release.apk`，150,614,212 字节（143.64 MiB）。
- 版本：`0.12.5-zh.1` / `10001`；包名：`ru.oldgold.zhcn`。
- 最低安装版本 Android 7.0 / API 24，目标 API 36。需要保持 Android System WebView 更新；最低安装版本不代表已在每个旧系统或机型上实测。
- APK SHA-256：`8fe92ff7068411e4840e1176f132afd9b5568e1df5de7240ba5bbbd21ccbde01`。
- 网页清单 SHA-256：`f82af5087c8a0cff5944976c014375e68319a183fd482193064f1d92622be3e5`。
- 签名证书 SHA-256：`cf968b44fe5ae5ea30eb0b6babe1679177a4656dc8c17947bf787d0cfde8b6ca`。APK v2 签名和 zipalign 校验通过，正式包 `debuggable=false`。

安装和存档备份步骤见 [Android 使用说明](../../mobile/README.zh-CN.md)。后续覆盖安装必须保持包名和签名；卸载或清除应用数据前应导出存档。

## 实现与验证

资源全部内置，使用应用本地 `https://localhost`，默认简体中文、横屏。保留原图像、动画、游戏机制和 JSON 存档格式；35 份中文词典共 10,312 条唯一译文。签名私钥和密码不随安装包分发。

实际 APK 的 502 个网页文件逐项 SHA-256 匹配，407 条资源依赖、35 份中文词典、图集索引/计划及其 4 张实际图集均通过独立校验。两份压缩动画帧库在 Android 打包时改用 `.gzip` 输出后缀，原始字节未变，防止构建工具自动解压和改名；真实 WebView 已成功加载 1,440 + 3,540 个预生成帧。

修复了两个实际复核发现的问题：加载期间的静态俄文菜单现会先完成翻译再显示；浏览器与原生后台事件共享成功存档去重，避免同次切后台重复写盘。退出确认仍强制保存，失败可重试，新局/读档不会被旧去重记录阻挡。

| 检查 | 结果与证据（相对项目根目录） |
| --- | --- |
| APK 内容独立复核 | 通过；`mobile/out/apk-independent-review.json` |
| 签名与对齐 | 通过；`mobile/out/release-signature.txt`、`release-zipalign.txt` |
| 语言框架与完整词典 | 14 项运行时检查、22 份 HTML、5 个季节提示通过；`npm run test:i18n` |
| 后台保存/导出/返回键边界 | 15 项通过；`node tests/native-android-test.js` |
| 旧 Web API 兼容 | 51 个等价用例通过；`node tests/mobile-compat-test.js` |
| 既有存档兼容 | 17 份旧存档通过；60 个损坏样本中 50 个恢复、10 个正确拒绝、0 崩溃；`node tests/save-test.js` |
| 加载与语法 | `npm run check` 通过：283 个入口脚本、364 个 JS 文件、227 个模拟脚本 |
| 首屏加载时序 | 默认中文、保存的英文、URL 指定俄文均通过；阻塞词典时不露出俄文，后续游戏脚本未完成时菜单已翻译且可排队选择；`mobile/out/startup-final.json` |
| 三种移动屏幕 | 844×390、390×844、640×360，11 屏均无俄文遗漏或文字溢出；中文输入/字形/断行、保存重载、离线素材与旧 API 降级通过；`mobile/out/web-smoke-final.json` |
| Android 原生完整流程 | 同源签名 debug 包的 9 阶段通过，0 运行异常、0 缺失资源；`mobile/out/device-final/report.json` |
| 正式 Release 包覆盖安装 | 通过；断网安装/启动、真实 ADB 触屏“继续游戏”进入村庄，英雄仍为“中文勇士·APK验收”；`mobile/out/device-release/report.json`、`preserved-hero.png` |
| 设备截图独立视觉复核 | 当前报告登记的 13 张截图逐项核对 SHA，通过；`mobile/out/device-independent-review.json` |
| 正式包画面独立复核 | 中文村庄/剧情与保留英雄名通过；`mobile/out/release-independent-review.json` |
| 三屏幕稳定缩远画面独立复核 | 冷/暖配对逐张核对，原地形加载完成后平色空带消失，暖图完整；`mobile/out/web-independent-review.json` 中 `stableZoomReview=passed` |

原生流程实测使用 Android 16 / API 36 模拟器、WebView 133，屏幕 2400×1080（横屏）、约 915×412 CSS 像素。覆盖断网本地启动、中文名存档、真实系统软键盘、后台保存/暂停/声音恢复、强停重开、系统文件选择器成功写出及取消、返回键关面板和取消退出。文件导出内容逐字节与原 JSON 比对。两次 Home 操作均仅写入一次自动存档，保持原暂停状态。

正式包没有使用 CDP 调试来触发续玩：通过实际屏幕坐标触控进入原村庄，点击头像后截图核对中文英雄名。该截图 SHA-256 为 `06831a91bd67c82f5dc5a4456c4da3ced56af1a18640d8b614d110de055415c9`；新进程没有 WebView 调试端口。

验收期间 Windows 上的 QEMU 模拟器进程曾以 `0xc0000005` 退出（`mobile/out/emulator-windows-crash.txt`），没有把当时仍在菜单的截图计为续玩成功。随后保留原 AVD 数据重启，并按 [Android 官方排障说明](https://developer.android.com/studio/run/emulator-troubleshooting) 关闭模拟器 Vulkan，完成上述正式包触控与保档验证；APK 字节未改变。这是测试环境处理，不能据此推断真机的图形性能。

屏幕测试的 `/coop-info` 是可选的本地合作服务探测。静态测试服务器明确返回“无本地合作服务”，没有放宽素材缺失、汉化或布局断言；修订前的原始结果保留在 `mobile/out/web-smoke-raw.json`。此项修改仅涉及测试服务器，APK 内容和上述发布代码未改变。

缩远镜头另补做冷/暖两阶段验证：原 11 张截图及其哈希保留，新配对证据在 `mobile/out/web-warm/acceptance.json`。不强制同步生成地形，等待原有分帧加载完成，核对视口内全部地形条带已就绪，且截图前后同一 generation、相机和画布保持不变。三种配置均完成；测试主机等待约 3.5～7.6 秒，这只是该次诊断耗时，不是真机加载时间承诺。加载过程中的暂时平色区域没有当作稳定画面验收。

## 性能结果与边界

**普通视角的绘制压力预算仍未达标。没有调整原阈值或降低测试画质来获得通过。**

测试直接使用包内对应的 `mobile/www`，386×837、DPR 3、Chrome CPU 4 倍降速。数值是项目的校准单位，不是真机帧率：

| 项目 | 实测 | 原预算 | 结果 |
| --- | ---: | ---: | --- |
| 巨魔冷帧 | 167.90 | 350 | 通过 |
| 幽灵冷帧 | 8.55 | 230 | 通过 |
| 普通视角 z=1 | 31.41 | 25 | 未通过 |
| 拉远视角 z=0.5 | 38.37 | 40 | 通过 |

完整数据见 `mobile/out/render-final.json`。原浏览器版本已有绘制预算超限记录，见 [浏览器验收记录](ACCEPTANCE.zh-CN.md)；跨时段样本不作为整场景提升或退步的结论。

中文 Canvas 微基准耗时约下降 24%，绘制像素、测量、断行及字体恢复结果一致；该微基准不代表整场景帧率提升。原有自适应轻量画质保留，中低端设备可使用“画质：轻量”。

没有连接实体手机，因此未测真机持续帧率、发热、续航、厂商后台策略，也没有逐个 Android 版本或刘海/折叠屏实测。联网合作模式不属于本次离线单机验收。

原项目完整测试的 16 项既有失败已在浏览器阶段记录并与基线对照；本次没有修改玩法来消除它们，也不宣称完整 `npm test` 全绿。
