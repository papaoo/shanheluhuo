# 本地网页资源构建

Android 和 Electron 共用 `desktop/build-www.js`。在项目根目录执行：

```powershell
node desktop/build-www.js mobile/www
node tools/check-www.js mobile/www
node tests/build-www-test.js
```

Android 开发依赖用 `npm ci --prefix mobile` 按锁文件安装。Android 构建优先使用该目录锁定的 esbuild；Electron 优先使用自己的依赖。只有明确需要调试原始代码时才传入 `--no-minify`。

构建器只允许覆盖项目中的 `mobile/www` 和 `desktop/www`，并拒绝把输出目录或其父目录重定向到其他位置的链接。输出目录会重新生成，不应手工存放文件。

## 资源范围

- 包含 `js`、`css`、`fonts`、`icons`、网页入口、所有 `assets/fantasy` 运行资源。
- 完整保留动态拼接路径的精灵图、图集 JSON、压缩帧库和 35 份中文词典；不会根据静态引用猜测并删除旧图。
- 保留 `roster-v4/artwork-index.json` 和 `phase-plan.json`：运行时的 `frog-troll-artwork.js` 会动态读取它们，再根据图集索引加载图片。校验器把它们列为必要依赖，不能当作制作资料排除。
- 排除 `assets/graphics-review`、Markdown，以及 `prompts.json`、`additional-prompts.json`、`graphics-reference-measured.json` 三份制作/测量资料。图片、字体和二进制帧库保持原始字节。
- 移除网页统计脚本与 PWA service worker 入口。APK 的服务器地址和网络功能由原生配置及游戏适配代码决定。
- 只在 Android 输出中复制 `mobile/compat.js` 并放到第一个脚本位置，原始浏览器网页不变。Capacitor 在 WebView 运行时注入原生桥，不需要手写一个不存在的 `capacitor.js` 入口。
- Android 会自动解压 assets 中以 `.gz` 结尾的文件并去掉扩展名。构建器只将两份蛙族压缩帧库的输出名从 `.bin.gz` 改成 `.bin.gzip`，精确更新入口对应的两个 `data-*-frames` URL，并记录 `source → path` 映射；gzip 字节和游戏解码逻辑保持不变，桌面输出也保持原名。

JavaScript 按原来的经典脚本逐文件压缩，不合并、不变为模块，保留跨文件使用的顶层名称。语法转换目标为 Chrome 85；UTF-8 字符保留原文，避免中文和俄文词典被转义后膨胀。该语法目标不等于提供所有现代 Web API，旧手机仍需要可用的 Android System WebView。

## 验证与复现

每次输出 `build-manifest.json`，记录源提交、已修改的跟踪文件、压缩器版本、构建选项、各组压缩前后字节数，以及每个文件的大小和 SHA-256。清单不含时间戳；输入文件、依赖和选项相同时可逐字节复现。

`check-www.js` 校验清单字节、HTML/CSS/JS 直接引用、图集内的相对图片引用、两个 gzip 帧库、原生入口与 Android 兼容脚本顺序。它执行实际打包后的语言运行时，检查默认中文以及全部中文/英文词典，并联合解析入口里的经典脚本以发现全局声明冲突。

对于 roster 图集，校验按照适配器的真实读取链：`phase-plan.roles → frames → 非空 pose → artwork-index 中 pose.role/pose.asset → PNG`。索引还保留了 12 个历史图集条目，当前计划只选择 4 个现存的 `*-v10.png`。校验覆盖所有计划实际选择的图集和帧，不把未使用的历史条目误报为打包缺图。

静态检查不会代替实机测试。APK 验收应对 `mobile/www` 实际产物进行浏览器加载、游戏存档场景和性能测试，再执行 Capacitor 同步与 Android 构建。源代码有更新时需重新构建资源；不要只同步之前的旧目录。

APK 构建后还需检查实际压缩包：

```powershell
node tools/check-apk.js mobile/OldGold-zh-CN-0.12.5-1-release.apk --write tests/i18n/out/apk-contents-release.json
```

该检查读取 APK 内每个网页文件并核对 SHA-256，同时验证内嵌清单与已验收网页产物相同、两个帧库与原始 gzip 数据相同、原生桥、真实 AndroidManifest 的应用 ID/横屏方向、本地 HTTPS 配置和中文词典。签名私钥与开发文件不得进入包内。Capacitor 同步只额外生成两个空 Cordova 占位文件，`index.html` 应与清单逐字节一致。APK 签名验证和原生生命周期测试仍需单独执行。
