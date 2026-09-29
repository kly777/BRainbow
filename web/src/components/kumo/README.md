# kumo/ — 从上游搬进来的 Kumo（SolidJS 版）组件

这一棵子树**不是本项目写的**，是 [photon-hq/kumo-solidjs] 里 `packages/kumo-solid`
（npm 上的 `@photon-ai/kumo-solid`，**尚未发布**，`private: true`）的源码副本。
所以只能整份搬进来，而不是 `pnpm add`。

[photon-hq/kumo-solidjs]: https://github.com/photon-hq/kumo-solidjs

## 搬了什么

- `components/<族>/`：**只用到的 17 个族**——text / link / badge / button / loader /
  input / input-group / field / label / select / checkbox / switch / tooltip / dialog /
  layer-card / surface / empty。
- `utils/`、`internal/`：上游的 `src/utils`、`src/internal` 整份（`cn`、`resolve-variant`、
  portal/link provider、图标表）。
- **目录层级照抄上游**（`components/<族>/<族>.tsx` + 与之平级的 `utils/`、`internal/`），
  这样组件里的 `../../utils/cn`、`../../internal/icons` 原样成立，**不需求改任何导入**，
  日后要跟上游同步就是覆盖文件。
- 与上游仅两处不同：**剔掉了 `*.test.tsx` / `*.type-spec.tsx`**（跑在上游自己的
  vite-plus 运行时上），以及 `index.ts` 只导出用到的族。

## 样式：为什么有一个 kernel 之外的 kumo.css

Kumo 组件用 Tailwind v4 的工具类 + `--color-kumo-*` 语义令牌（上游 `packages/kumo/src/styles/`）。
本项目不用 Tailwind，所以**把需要的 CSS 预编译成一份静态文件** `kumo.css` 一起提交，
由 `index.ts` 侧效应导入。产物特点：

- 只含 **theme + utilities + Kumo 自己的组件样式**，**不含 Tailwind 的 preflight**
  —— 那套全局重置会覆盖本项目的 `global.css`。
- 用 `@source` 只扫描本目录，Tailwind 的 JIT 因此只产出这里真正用到的工具类
  （74 KB / gzip 13 KB）。
- 暗色由 `<html data-mode="dark">` 驱动（上游 `kumo-binding.css` 的约定），
  本项目在 `app/theme.ts` 里按解析后的主题写这个属性 —— 否则 `midnight` 主题下
  Kumo 组件仍是亮色。

重建（改了本目录的组件、或上游同步之后）：

```bash
# 1. 取上游（只要 styles 与这次搬的组件源码）
git clone --depth 1 https://github.com/photon-hq/kumo-solidjs /tmp/kumo-solidjs
# 2. 装 Tailwind CLI（临时目录，不进本项目依赖）
mkdir -p /tmp/kumo-css-build && cd /tmp/kumo-css-build
cp /tmp/kumo-solidjs/packages/kumo/src/styles/*.css .
pnpm add -D tailwindcss @tailwindcss/cli
# 3. 组装输入：theme + utilities（不要 preflight）+ Kumo 组件样式
cat > in.css <<'CSS'
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "./kumo.css";           /* 组件样式（含 @theme 令牌）；记得删掉 :root{color-scheme:light} */
@source "/home/kly/BRainbow/web/src/components/kumo";
CSS
npx @tailwindcss/cli -i in.css -o /home/kly/BRainbow/web/src/components/kumo/kumo.css --minify
```

## 上游版本

搬运时上游仓库 HEAD（2026-09-26）：`@photon-ai/kumo-solid` version `0.0.0`，
peer 依赖 `solid-js ^1.9`、`@photon-ai/base-ui-solid 1.0.0-beta.13`（后者已发布，
是 `package.json` 里的正式依赖）。
