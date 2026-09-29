/**
 * Kumo（Cloudflare 设计系统）的 SolidJS 版组件——**从上游搬进来的子集**。
 *
 * 来源：https://github.com/photon-hq/kumo-solidjs 的 `packages/kumo-solid`
 * （`@photon-ai/kumo-solid`，**未发布到 npm**，所以只能搬源码）。
 * 搬运范围与重建 CSS 的方法见 ./README.md；这里只把用到的族重新导出。
 *
 * 与上游的差别只有两处：① 不带 `*.test.tsx`（用的是 vite-plus 的测试运行时）；
 * ② 不导出没用到的族（chart / code / date-picker / …），免得把无关代码拉进产物。
 */
// 组件样式（Tailwind 预编译产物，只含用到的工具类；导入这个 barrel 就自带）
import "./kumo.css";

export {
	Badge,
	type BadgeProps,
	type KumoBadgeVariant,
} from "./components/badge";
export {
	Button,
	type ButtonProps,
	buttonVariants,
	type KumoButtonSize,
	type KumoButtonVariant,
	LinkButton,
	RefreshButton,
} from "./components/button";
export { Checkbox, type CheckboxProps } from "./components/checkbox";
export { Dialog, type DialogProps } from "./components/dialog";
export { Empty, type EmptyProps } from "./components/empty";
export {
	Field,
	type FieldProps,
	normalizeFieldError,
} from "./components/field";
export {
	Input,
	InputArea,
	type InputAreaProps,
	type InputProps,
	type KumoInputSize,
	Textarea,
} from "./components/input";
export {
	InputGroup,
	type InputGroupRootProps,
} from "./components/input-group";
export { Label, type LabelProps } from "./components/label";
export { LayerCard } from "./components/layer-card";
export { Link, type LinkProps } from "./components/link";
export { Loader, type LoaderProps, SkeletonLine } from "./components/loader";
export {
	Select,
	type SelectItemValue,
	type SelectProps,
} from "./components/select";
export { Surface } from "./components/surface";
export { Switch, type SwitchProps } from "./components/switch";
export { type KumoTextVariant, Text, type TextProps } from "./components/text";
export { Tooltip, type TooltipProps } from "./components/tooltip";

/** 浮层挂载点与路由链接适配（要用 Solid Router 导航时装 `LinkProvider`） */
export {
	KumoPortalProvider,
	type LinkComponentProps,
	LinkProvider,
	useLinkComponent,
} from "./utils";
