# CDN Dash

一个面向**单用户私人图床**的 GitHub CDN 管理后台。前端只负责选图、浏览与复制链接；GitHub Token 只保存在 Cloudflare Pages Functions 的 Secret 中，不会进入浏览器、LocalStorage 或静态构建产物。

默认配置已经针对本项目的使用场景设置为：

- 目标仓库：`MadisonWirtanen/cdn`
- 目标分支：`master`
- 公开 CDN：`https://cdn.003153.xyz`
- 默认上传目录：`image`

项目不会初始化、迁移、改名或重排 `cdn` 仓库的现有结构。上传只会在你选定的路径新增图片；覆盖与删除属于显式操作，并有保护路径限制。

## 功能

- 拖拽、粘贴、文件选择上传图片
- 批量队列，按顺序稳定提交到 GitHub
- 可选浏览器端 WebP 转换与质量设置
- 时间戳、原文件名、SHA-256 内容哈希三种命名方式
- 指定任意已有目录上传；GitHub 会随文件自动形成对应路径
- 图片管理：目录浏览、预览、复制 URL / Markdown、打开原图、删除图片
- 同名文件默认拒绝覆盖；可手动开启覆盖
- 上传后可自动检查 `cdn.003153.xyz` 是否已经可访问
- GitHub Token 完全位于 Cloudflare 服务端 Secret
- 固定保护 `index.html`、`404.html`、`CNAME`、`vercel.json`、`.settings`、`.deploy`
- 无前端框架、无第三方运行时依赖，Cloudflare Pages 构建简单稳定

## 安全模型

请求路径为：

```text
浏览器
  -> Cloudflare Access
  -> CDN Dash (Pages)
  -> /api/* (Pages Functions)
  -> GitHub API + GITHUB_TOKEN
  -> MadisonWirtanen/cdn@master
  -> Vercel
  -> https://cdn.003153.xyz/<path>
```

浏览器永远拿不到 GitHub Token。

**重要：不要只保护自定义管理域名而放任 `*.pages.dev` 公开访问。** Pages Functions 与 Secret 同时存在于 Pages 项目中，如果 `pages.dev` 仍可公开访问，就可能绕过你的自定义域名 Access 策略。生产使用时请执行以下至少一项：

1. 给项目的 `*.pages.dev` 地址也配置 Cloudflare Access；或
2. 绑定自定义域名后，在 Cloudflare Pages 中禁用 `pages.dev` 子域访问；并且
3. 推荐在 `wrangler.toml` 中把 `ALLOWED_HOSTS` 设置成最终管理域名，例如 `image-admin.003153.xyz`。

`ALLOWED_HOSTS` 非空时，所有 `/api/*` 请求都会额外校验 Host。这样即使其他 Pages 入口仍存在，也无法调用 GitHub API。

## 一、准备 GitHub Token

推荐创建 **Fine-grained personal access token**，只授权给 `MadisonWirtanen/cdn`，不要使用权限过大的长期 Token。

建议权限：

- Repository access：只选择 `cdn`
- Contents：**Read and write**
- Metadata：Read（GitHub 默认/必需）

Token 只会配置到 Cloudflare 的加密 Secret，不要写入仓库、`.env`、`wrangler.toml` 或浏览器。

## 二、一键导入 Cloudflare Pages

在 Cloudflare Dashboard：

1. 打开 **Workers & Pages**。
2. 选择 **Create / Import an existing Git repository**（页面文案可能随版本略有变化）。
3. 连接 GitHub，选择仓库 `MadisonWirtanen/cdndash`。
4. 项目名称建议保持 `cdndash`。
5. 生产分支选择 `main`。
6. Framework preset 选择 **None**。
7. Build command：

   ```text
   npm run build
   ```

8. Build output directory：

   ```text
   dist
   ```

9. Root directory 保持仓库根目录。
10. 部署。

仓库根目录已经包含 `wrangler.toml`，其中 `pages_build_output_dir = "./dist"`。Cloudflare Pages 使用该 Wrangler 文件时，它会成为 Pages Functions 配置的 source of truth。

项目也包含 `.node-version`，固定 Node.js 22，与当前 Cloudflare Pages v3 构建环境匹配。

## 三、配置 Cloudflare Secret

首次部署完成后：

1. 进入 Cloudflare **Workers & Pages**。
2. 进入 `cdndash` 项目。
3. 打开 **Settings -> Variables and Secrets**。
4. 新增：

   ```text
   GITHUB_TOKEN
   ```

5. 值填写刚才创建的 GitHub Token。
6. 选择 **Encrypt / Secret**，不要创建成明文普通变量。
7. 保存并重新部署一次生产环境。

如果没有配置 `GITHUB_TOKEN`，页面可以打开，但顶部连接检测会显示失败，上传与管理 API 不会工作。

## 四、当前固定配置

`wrangler.toml` 已包含以下安全的非敏感配置：

```toml
[vars]
TARGET_OWNER = "MadisonWirtanen"
TARGET_REPO = "cdn"
TARGET_BRANCH = "master"
PUBLIC_BASE_URL = "https://cdn.003153.xyz"
DEFAULT_UPLOAD_DIR = "image"
MAX_UPLOAD_MB = "15"
ALLOW_DELETE = "true"
ALLOW_OVERWRITE = "true"
PROTECTED_PATHS = "index.html,404.html,CNAME,vercel.json,.settings,.deploy"
ALLOWED_HOSTS = ""
```

### 建议正式上线后修改 `ALLOWED_HOSTS`

假设最终后台域名为：

```text
image-admin.003153.xyz
```

修改为：

```toml
ALLOWED_HOSTS = "image-admin.003153.xyz"
```

如果确实需要多个入口，可以用逗号分隔：

```toml
ALLOWED_HOSTS = "image-admin.003153.xyz,cdndash.pages.dev"
```

除非 `cdndash.pages.dev` 本身也已经受到 Access 保护，否则不建议把它加入生产白名单。

由于 Wrangler 配置文件是 Pages Functions 的配置 source of truth，修改这些普通变量最稳妥的方法就是修改 `wrangler.toml` 并提交，让 Cloudflare 自动重新部署。

## 五、绑定管理域名与 Cloudflare Access

建议单独使用一个**私人管理域名**，例如：

```text
image-admin.003153.xyz
```

不要给 `cdn.003153.xyz` 本身加 Access，因为它是博客、网页等公开资源真正引用图片的地址。

绑定后台域名后，在 Zero Trust 中：

1. 进入 **Access controls -> Applications**。
2. 新建或复用 Self-hosted Application。
3. 添加 `image-admin.003153.xyz`。
4. Allow Policy 只允许你自己的账号 / 邮箱。
5. 确认未授权访问会被 Access 拦截。
6. 修改 `wrangler.toml` 的 `ALLOWED_HOSTS` 为该域名并提交。
7. 最后禁用或保护 `cdndash.pages.dev`。

推荐最终形成：

```text
公开：cdn.003153.xyz              -> Vercel -> cdn 仓库
私有：image-admin.003153.xyz      -> Cloudflare Access -> CDN Dash
```

## 六、使用方式

### 上传

打开后台后直接进入上传页：

1. 输入目录，例如 `image`、`image/blog`、`picx/2026`。
2. 拖入、粘贴或选择图片。
3. 可开启 WebP 转换并设置质量。
4. 可在上传前直接修改最终文件名。
5. 点击 **开始上传**。
6. GitHub 提交成功后可直接复制 CDN URL。
7. 如果启用了“上传后检测 CDN”，界面会继续检查 Vercel/CDN 是否已经能访问该文件。

上传不会移动已有文件，也不会修改仓库中其他路径。

### 同名文件

默认行为：**拒绝覆盖**。

如确实需要替换某个图片，勾选：

```text
允许覆盖同名图片
```

服务器仍会拒绝覆盖保护路径。

### 图片管理

“图片管理”页面：

- 显示当前目录下的子目录
- 只显示图片文件，不显示 HTML、JS、字体等其他资源
- 可以复制 URL / Markdown
- 可以打开公开 CDN 地址
- 可以删除图片

删除会让原 CDN 地址失效，因此前端会再次确认；保护路径永远不可删除。

## 七、浏览器偏好不会污染 cdn 仓库

以下设置保存在浏览器 LocalStorage：

- 默认上传目录
- WebP 开关和质量
- 文件命名方式
- 默认复制格式
- 是否自动检查 CDN

项目不会继续读取或覆盖 `cdn` 旧 PicX 的 `.settings` / `.deploy` 文件。

## 八、本地校验

本项目没有 npm 依赖，因此拉取代码后直接运行：

```bash
npm run verify
```

它会：

- 对所有前端、Pages Functions 和构建脚本执行 JavaScript 语法检查
- 检查浏览器代码中不存在 `GITHUB_TOKEN` 引用或常见 GitHub Token 字样
- 将 `public/` 构建到 `dist/`

本地开发 Pages Functions 时，可以自行安装/使用 Wrangler，再将真实 Token 放在未提交的 `.dev.vars` 中。仓库提供了 `.dev.vars.example` 作为格式参考。

## 九、目录结构

```text
cdndash/
├─ public/                 # 静态前端
│  ├─ index.html
│  ├─ _headers
│  └─ assets/
│     ├─ app.js
│     └─ styles.css
├─ functions/              # Cloudflare Pages Functions
│  ├─ _lib/
│  │  ├─ config.js
│  │  ├─ github.js
│  │  └─ http.js
│  └─ api/
│     ├─ config.js
│     ├─ health.js
│     ├─ list.js
│     ├─ upload.js
│     ├─ delete.js
│     └─ check.js
├─ scripts/
│  ├─ build.mjs
│  └─ check.mjs
├─ wrangler.toml
├─ .node-version
├─ .dev.vars.example
├─ package.json
└─ README.md
```

## 十、设计原则

1. **cdn 仓库路径不迁移**：现有 URL 永不因为后台项目而改变。
2. **Token 不进浏览器**：只存在于 Cloudflare Secret。
3. **单用户优先**：删除 GitHub OAuth、仓库选择、自动建仓等通用图床逻辑。
4. **危险操作显式开启**：覆盖默认关闭，删除需要确认，关键文件服务端硬保护。
5. **配置与内容分离**：CDN Dash 自己的偏好不写入 `cdn`。
6. **稳定优先**：批量图片逐张顺序提交，避免并发 Git commit 产生分支竞争。

## License

MIT。该项目参考了 PicX 的产品使用思路，但代码为独立实现，不包含 PicX 源代码。
