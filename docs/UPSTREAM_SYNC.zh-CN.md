# shanheluhuo：上游同步与合并

建立日期：2026-11-17。目标是独立维护中文版，同时持续接收 OldGold 的代码更新，保留可追溯的共同历史。

## 仓库与基线

| 项目 | 约定 |
| --- | --- |
| 自有仓库 `origin` | `https://github.com/papaoo/shanheluhuo.git` |
| 原项目 `upstream` | `https://github.com/xXxLexolasxXx/OldGold.git` |
| 自有主分支 | `main`，跟踪 `origin/main` |
| 上游主分支 | `upstream/main`，仅用于获取和对照 |
| 初始上游提交 | `b1ec26d2f2eb7ff131a3fad7347bb5199d2090ac` |
| 固定初始基线标签 | `upstream-baseline/2026-11-17`，以后不移动此标签 |
| 迁移前中文版提交 | `e7c30e669e175c13800108f7ba19716cc04bfe5a` |
| 迁移前本地备份分支 | `codex/backup-before-shanheluhuo-20261117`，仅本机保存 |

完整上游历史及其后的 9 个中文/Android 提交均保留。初始基线标签只标记起点；后续已合入的上游位置由 Git 合并关系确定。不要通过重新初始化仓库、复制文件覆盖或强制推送来同步。

本次范围是仓库配置、项目入口说明与同步流程，不改变游戏机制、画面、应用包名或存档格式，也不重新发布 APK。整合负责人先检查两边差异；独立检查者复核冲突处理、汉化和 Android 保留项。已有三份未跟踪的本地分析/交接文档继续留在原位置，不随本次初始化提交上传。

初次上传完成的条件：远端 `main` 与本地 `main` 相同；基线标签在远端可读且指向上述原始提交；该提交仍是自有 `main` 的祖先；未包含 APK、签名私钥和个人存档。图形改动另遵循仓库的图形协作规则。

## 在新电脑上配置

`git clone` 不会复制本机的第二远端及 Git 配置。新电脑需要执行：

```powershell
git clone https://github.com/papaoo/shanheluhuo.git
cd shanheluhuo
git remote add upstream https://github.com/xXxLexolasxXx/OldGold.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
git config push.default simple
git config branch.main.pushRemote origin
git config branch.main.rebase false
git config pull.ff only
git fetch upstream main --no-tags
```

`DISABLED` 是不可用的推送地址，用来阻止误推到原作者仓库；不影响获取更新。代理如有需要，只对本次 Git 命令设置，不提交地址、账号或令牌。

## 检查上游更新

先处理已跟踪文件的未提交修改；保留本地分析文档和用户数据。不要用 `reset --hard`、`clean` 或覆盖文件处理同步。

```powershell
git status --short
git switch main
git pull --ff-only origin main
git fetch upstream main --no-tags
git rev-list --left-right --count main...upstream/main
git log --oneline main..upstream/main
git diff --stat main...upstream/main
git merge-base main upstream/main
```

计数左侧为自有分支独有的提交，右侧为尚未合入的上游提交。右侧为 `0` 时无须合并。三点差异用于审查上游从共同祖先以来的变化；不要把中文版自身的差异当成漏同步。

## 在独立分支中整合

确认有新提交后，从最新自有 `main` 创建本次分支。用实际日期替换示例名；同日第二次同步使用新后缀。

```powershell
git switch -c codex/sync-upstream-YYYYMMDD main
git merge --no-ff --no-commit upstream/main
git status --short
git diff --name-only --diff-filter=U
git diff --cached --stat
```

冲突需要结合共同祖先、中文版和上游三方内容处理；不要整文件统一选择 `ours` 或 `theirs`。先列明本次上游 SHA、改动范围、负责人和验收条件，独立复核后再提交。

每次重点检查：

- **入口与语言**：`index.html`、`js/i18n.js`、`sw.js`；默认中文、显式语言选择、首次加载时序和词典缓存。
- **新增文案**：`js/i18n/zh-CN-*.js`、术语表与实际界面；保留占位符，补齐新增俄文及拼接文本。
- **存档**：`js/save.js`、`js/savefile.js`、`js/profile.js`；旧存档与损坏存档的恢复行为不被破坏。
- **Android**：`js/native.js`、后台保存去重、返回键、系统文件导出/取消、离线资源路径及压缩帧库。
- **构建与界面**：`desktop/build-www.js`、`mobile/`、CSS 与 Canvas；保留适配改动，并实测上游新界面。

## 检查与提交

依赖按需安装：Android 构建检查需要 `npm ci --prefix mobile`；浏览器检查需要 `npm ci --prefix tools/browsers` 和本机 Chrome/Edge。

```powershell
git diff --check
git diff --cached --check
npm run check
npm run test:i18n
npm run audit:zh
npm run test:android
node tests/save-test.js
```

根据本次改动补跑相关模拟、浏览器或 Android 测试。界面变化需要检查真实任务流程、可读字号、遮挡和触控，不能只看按钮是否溢出。渲染变化按 `AGENTS.md` 执行 `npm run test:render` 及移动端冷/暖场景检查。

既有完整测试失败及性能预算超限见历史[浏览器验收](localization/ACCEPTANCE.zh-CN.md)和 [APK 验收](localization/APK_ACCEPTANCE.zh-CN.md)。新失败必须对照本次基线判断，不得因为旧报告已有失败便忽略新回归，也不得修改阈值来获得通过。旧验收记录不代表新合并版本已通过。

完成冲突处理及验证后，只暂存本次解决的文件；正常自动合并的文件已在暂存区。不要用 `git add .` 混入个人文档或构建产物。

```powershell
git commit -m "Merge upstream OldGold updates"
git switch main
git merge --ff-only codex/sync-upstream-YYYYMMDD
git push origin main
```

如果主分支在检查期间已变化，先把最新 `origin/main` 合入整合分支并重新检查，不能强推覆盖。需要远程审查时可以先推整合分支并发起 PR，审查通过后再合入 `main`。

## 上传边界

源码、依赖锁定文件、测试、原作者历史和公开开发说明纳入仓库。APK、签名密钥/密码、模拟器、构建缓存、个人存档和合作服务器账号数据不纳入 Git。以后发布 APK 需要另行构建、验收，并在 GitHub Releases 中单独分发；同步源码不会自动更新已经安装的 APK。

当前保留上游 CI 工作流；本次推送会触发的检查结果属于新仓库自身，不沿用原作者仓库的状态。仓库分支保护规则及 GitHub Pages 并未由本地 Git 配置自动建立。
