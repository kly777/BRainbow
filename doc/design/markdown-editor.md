# MarkdownEditor — 统一编辑与预览组件

> 状态：已定稿

---

## 1. 动机

当前 Markdown 编辑分散在多个组件中，逻辑重复、行为不一致：

| 组件 | 编辑 | 粘贴增强 | 预览 |
|------|------|---------|------|
| `Memo.tsx` | textarea | ✅ | ❌ |
| `CardEdit.tsx` | 手写 textarea | ✅（手写） | ✅ |
| `MemAdd.tsx` | 用 Memo×2 | 继承 Memo | ❌ |

合并为单一 `MarkdownEditor`，统一粘贴、拖拽行为和预览能力。

---

## 2. MarkdownEditor 组件

### 2.1 Props

```ts
interface MarkdownEditorProps {
  value: string;
  onInput: (value: string) => void;
  preview?: boolean;          // 是否显示预览面板（默认 false）
  rows?: number;              // textarea 行数（默认 6）
  placeholder?: string;
  class?: string;
  id?: string;
}
```

### 2.2 粘贴增强

| 粘贴内容 | 行为 |
|----------|------|
| 图片文件 | 调用 `mediaApi.uploadMedia` → 插入 `![](url)` |
| URL + 选中文字 | 转为 `[选中文字](url)` |

### 2.3 拖拽上传

textarea 区域支持拖拽图片文件：

- `dragover` — 显示视觉反馈（边框高亮）
- `drop` — 获取文件 → `mediaApi.uploadMedia` → 在光标处插入 `![](url)`
- 多文件：逐个插入

### 2.4 结构

```
┌─────────────────────────────────────┐
│  textarea                           │
│  (粘贴 + 拖拽增强)                   │
├─────────────────────────────────────┤
│  [preview 开启时]                    │
│  <MarkdownRenderer content={value}/> │
└─────────────────────────────────────┘
```

---

## 3. MarkdownRenderer 组件（原 Markdown.tsx 增强）

### 3.1 技术栈

| 层 | 库 | 职责 |
|----|-----|------|
| 解析 | `marked` | Markdown → HTML |
| 代码高亮 | `highlight.js` | 代码块语法着色 |
| 安全 | `dompurify` | XSS 防护 |

### 3.2 代码高亮

`highlight.js` 集成进 `marked`：

```
marked.setOptions({
  gfm: true,
  breaks: true,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return code;
  }
});
```

CSS：引入 `highlight.js` 主题样式（如 `github` 或 `github-dark`），放在 `markdown.css` 中或独立引入。

---

## 4. 使用方式

### CardEdit

```tsx
<MarkdownEditor
  value={content()}
  onInput={setContent}
  preview
  rows={20}
  placeholder="输入 Markdown 内容..."
/>
```

### MemAdd

```tsx
<MarkdownEditor
  value={cue()}
  onInput={setCue}
  placeholder="线索（Markdown）"
/>
<MarkdownEditor
  value={target()}
  onInput={setTarget}
  placeholder="答案（Markdown）"
/>
```

### MemPage / MemManage 编辑弹窗

```tsx
<MarkdownEditor value={editCue()} onInput={setEditCue} />
<MarkdownEditor value={editTarget()} onInput={setEditTarget} />
```

---

## 5. 迁移清单

| 文件 | 变更 |
|------|------|
| **新增** `components/ui/MarkdownEditor.tsx` | 统一编辑器（粘贴+拖拽+预览） |
| **新增** `components/ui/markdown-editor.css` | 编辑器样式（拖拽高亮等） |
| **修改** `components/ui/Markdown.tsx` | 集成 highlight.js，重命名为 MarkdownRenderer |
| **修改** `components/ui/markdown.css` | 追加代码高亮主题样式 |
| **删除** `components/ui/Memo.tsx` | 旧 Memo 组件 |
| `pages/card/CardEdit.tsx` | `Markdown` → `MarkdownRenderer`；textarea → `MarkdownEditor` |
| `pages/MemAdd.tsx` | `Memo` → `MarkdownEditor` |
| `pages/MemPage.tsx` | `Memo` / `Markdown` → `MarkdownEditor` / `MarkdownRenderer` |
| `pages/MemManage.tsx` | `Memo` / `Markdown` → `MarkdownEditor` / `MarkdownRenderer` |
| `components/card/Card.tsx` | `Markdown` → `MarkdownRenderer` |
| `pages/card/CardDetail.tsx` | `Markdown` → `MarkdownRenderer` |

### 新增依赖

```
package.json:
  "highlight.js": "^11.11.0"
```

---

## 6. 图片上传统一

> **本节已过时（实现已改）**：media 模块在 v15 被文件服务取代，`mediaApi.uploadMedia` 不存在了。
> 现在编辑器**不认任何业务模块** —— 上传实现与"从文件库挑选"都由使用方通过 props 注入
> （`onUploadFile` / `filePicker`，实现见 `modules/file/markdown-editor-support.tsx`），
> 原因是 `components` 层不得反向依赖 `modules`（判据见 `doc/guides/component-design.md` §5）。
> 编辑器侧的行为约定：没注入就不出现对应 UI，粘贴/拖入失败要自己提示
> （`doc/guides/error-handling.md` §2 的边界）。

---

## 7. 实施顺序

1. 集成 `highlight.js` → 增强 `MarkdownRenderer`
2. 创建 `MarkdownEditor`（粘贴 + 拖拽 + 预览）
3. 替换 CardEdit
4. 替换 MemAdd / MemPage / MemManage
5. 删除 `Memo.tsx`
