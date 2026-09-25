// 两个全局 store 住在 shared/utils/（`shared/errors/` 的提示与动作层要用它们，
// 而 shared 不得反向依赖 UI）。这里按原样再导出，`@components/ui` 的消费者不受影响。
export * from "@shared/utils/confirmStore.ts";
export * from "@shared/utils/toastStore.ts";
export { default as Badge } from "./atoms/Badge.tsx";
export { default as Button } from "./atoms/Button.tsx";
export type {
	ControlSize,
	ControlTone,
} from "./atoms/control.ts";
export { default as InfoHint } from "./atoms/InfoHint.tsx";
export { default as Input, type InputProps } from "./atoms/Input.tsx";
export {
	type LayoutAlign,
	type LayoutGap,
	type LayoutJustify,
	Row,
	Stack,
} from "./atoms/Layout.tsx";
export {
	default as Markdown,
	type MarkdownRendererProps,
} from "./atoms/Markdown.tsx";
export { default as SearchInput } from "./atoms/SearchInput.tsx";
export { default as Select, type SelectProps } from "./atoms/Select.tsx";
export { LoadingSkeleton } from "./atoms/Skeleton.tsx";
export { default as Spinner } from "./atoms/Spinner.tsx";
export {
	default as Textarea,
	type TextareaProps,
} from "./atoms/Textarea.tsx";
export { default as Tooltip } from "./atoms/Tooltip.tsx";
export { AsyncSection } from "./molecules/AsyncSection.tsx";
export { AsyncView } from "./molecules/AsyncView.tsx";
export { default as BackLink } from "./molecules/BackLink.tsx";
export { default as EmptyState } from "./molecules/EmptyState.tsx";
export { default as ErrorRetry } from "./molecules/ErrorRetry.tsx";
export { default as Field, type FieldProps } from "./molecules/Field.tsx";
export { default as FilterGroup } from "./molecules/FilterGroup.tsx";
export { default as PageHead } from "./molecules/PageHead.tsx";
export { default as SimplePagination } from "./molecules/SimplePagination.tsx";
export { default as Toolbar } from "./molecules/Toolbar.tsx";
// 注意：`molecules/TagInput.tsx` 与 `molecules/TagFilter.tsx` **刻意不在这里导出**。
// 它们只被懒加载页面（file / bookmark）用到，而 barrel 被首屏链路引用 —— 从 barrel
// 导出会让它们落进入口也加载的共享 chunk。实测：从 barrel 导出时首屏同步链
// +12.7 KB（gzip +3.1 KB），改成让消费方按路径 import（`@components/ui/molecules/TagInput.tsx`，
// 仓库里 EmptyGuide / ErrorRetry 也是这么引 Button 的）后回到 +1.7 KB。
export { default as ConfirmModalContainer } from "./organisms/ConfirmModal.tsx";
export {
	type DetailPageProps,
	default as DetailPage,
} from "./organisms/DetailPage.tsx";
export {
	default as ListPage,
	type ListPageProps,
} from "./organisms/ListPage.tsx";
export { default as Modal } from "./organisms/Modal.tsx";
export { default as ToastContainer } from "./organisms/Toast.tsx";
