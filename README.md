# CDN Dash

CDN Dash 是一个面向单用户使用场景的 GitHub CDN 文件管理后台。前端运行在 Cloudflare Pages，GitHub Token 只保存在 Pages Functions 的 Secret 中。

固定目标：
- Repository: MadisonWirtanen/cdn
- Branch: master
- Public base URL: https://cdn.003153.xyz

CDN Dash 不迁移、不重排 cdn 仓库目录。只有在你主动执行覆盖、删除或重命名时，现有路径才会发生变化。

## v2 主要变化

- 支持上传和管理任意普通文件，不再只支持图片。
- 单文件前端与后端双重限制为 25 MB；正常界面不显示限制，只有超限时提示。
- 图片默认原样上传，不再默认转换 WebP。
- WebP 转换仍作为可选功能保留。
- 默认命名方式为自定义名称：进入队列时保留原文件名，并可直接编辑。
- 可选时间戳 + 随机码或内容哈希命名。
- 一次上传队列只生成一个 Git commit。
- 已上传文件支持重命名；重命名复用原 Git blob，不重新上传文件内容。
- 文件管理页显示全部文件，图片显示缩略图，其余文件显示类型卡片。
- Markdown / HTML 复制会根据文件类型自动生成图片或普通链接。

## 批量上传原理

v2 使用 GitHub Git Data API，而不是对每个文件分别调用 Contents API 提交。

流程：
1. 选择多个文件。
2. 批次预检查目标路径和冲突。
3. 逐个创建 Git Blob，但不修改 master。
4. 全部成功后一次创建 Git Tree。
5. 一次创建 Git Commit。
6. 一次更新 master。

如果暂存阶段有任何文件失败，master 不会发生变化。提交前还会再次检查分支 HEAD；如果上传期间 master 被其他操作更新，本批次会拒绝提交，避免覆盖并发修改。

单批最多处理 100 个文件。

## 文件重命名

重命名在同一个 commit 中完成：
- 新路径指向原 blob SHA。
- 旧路径从 tree 中删除。

因此重命名不会重新下载或重新上传文件内容。

重命名会改变公开 URL，界面会明确提示原 CDN 链接将失效并要求二次确认。

当前重命名只允许修改文件名，不允许通过斜杠移动目录。

## 保护路径

以下路径由服务端硬保护：
- index.html
- 404.html
- CNAME
- vercel.json
- .settings
- .deploy

这些路径不能通过 CDN Dash 覆盖、删除或重命名。

## Cloudflare Pages

推荐设置：
- Framework preset: None
- Build command: npm run build
- Build output directory: dist
- Production branch: main

wrangler.toml 中固定：
- TARGET_OWNER = MadisonWirtanen
- TARGET_REPO = cdn
- TARGET_BRANCH = master
- PUBLIC_BASE_URL = https://cdn.003153.xyz
- DEFAULT_UPLOAD_DIR = image
- MAX_UPLOAD_MB = 25
- ALLOW_DELETE = true
- ALLOW_OVERWRITE = true
- ALLOW_RENAME = true
- ALLOWED_HOSTS = cdndash.003153.xyz

Cloudflare Pages 必须配置加密 Secret：GITHUB_TOKEN。

建议使用 Fine-grained GitHub PAT，仅授权 MadisonWirtanen/cdn，并给予 Contents Read and write 与 Metadata Read 权限。

## Access

生产管理入口为 https://cdndash.003153.xyz ，应由 Cloudflare Zero Trust Access 保护。

ALLOWED_HOSTS 还会在 Pages Functions 层限制 API Host，因此默认 pages.dev 地址不应被加入 API 白名单。

## 使用

上传：
1. 填写上传目录。
2. 拖入、粘贴或选择任意文件。
3. 文件进入队列后可直接修改最终文件名。
4. 如需要，可勾选图片转换为 WebP。
5. 如目标路径已存在，可主动开启允许覆盖同名文件。
6. 点击开始上传。
7. 整个队列完成暂存后只产生一个 Git commit。

文件大小：
- 单文件最大 25 MB。
- 正常界面不显示限制。
- 选择超限文件时，该文件不会进入队列，并显示实际大小和超限提示。

命名：
- 默认：自定义名称，保留原文件名并允许编辑。
- 可选：时间戳 + 随机码。
- 可选：内容哈希。

旧版本 LocalStorage 会自动迁移到 v2 默认值：
- WebP 转换关闭。
- 命名改为 custom。
- 原来的默认目录、复制格式和 CDN 检测偏好继续保留。

文件管理页支持目录、图片、视频、音频、PDF / Office、压缩包、代码 / 文本、字体和其他普通文件。

普通文件操作：
- 复制链接
- 复制 Markdown
- 打开
- 重命名
- 删除

受保护文件不会提供危险操作。

## CDN 状态

GitHub 提交成功和 CDN 可访问是两个独立状态。

CDN Dash 会先确认 GitHub commit，然后可选地轮询 https://cdn.003153.xyz/<path> 。如果当前 CDN 发布端尚未同步，GitHub 上传仍然算成功，界面会单独提示 CDN 暂不可访问。

## 项目结构

主要目录：
- public/：静态前端
- functions/_lib/：GitHub、配置和 HTTP 公共逻辑
- functions/api/preflight.js：批次预检查
- functions/api/stage.js：创建单文件 Git blob
- functions/api/commit.js：一次 tree + commit + branch ref
- functions/api/rename.js：文件重命名
- functions/api/list.js：通用文件浏览
- functions/api/delete.js：删除
- functions/api/check.js：CDN 可用性检查
- scripts/：构建与校验脚本

## 校验

运行 npm run verify。

它会执行 JavaScript 语法检查、必需文件检查、前端 Secret 引用检查、通用文件上传检查、默认不压缩检查、默认 custom 命名检查以及批量 preflight / commit 流程检查，然后构建 dist。

## PWA / iPhone

CDN Dash 支持作为 PWA 安装到手机主屏幕。

iPhone 安装方式：
1. 使用 Safari 打开 https://cdndash.003153.xyz 。
2. 完成 Cloudflare Access 登录。
3. 点击 Safari 的“分享”按钮。
4. 选择“添加到主屏幕”。
5. 从主屏幕打开 CDN Dash，即会以独立 App 窗口运行。

PWA 使用 Prussian Blue 风格图标，并适配 iPhone 安全区域。

Service Worker 只缓存前端应用外壳（CSS、JS、Manifest 和图标），不会缓存 /api/ 请求、文件列表、上传结果或 CDN 文件内容，因此不会改变现有的 Cloudflare Access 和后端权限模型。

## License

MIT.
