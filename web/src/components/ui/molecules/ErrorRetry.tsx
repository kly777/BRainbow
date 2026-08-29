import Button from "@components/ui/atoms/Button.tsx";
import { getErrorMessage } from "@shared/api/types/index.ts";
import type { Component } from "solid-js";

interface ErrorRetryProps {
	error: unknown;
	onRetry: () => void;
	message?: string;
}

/** 通用错误+重试块，用于详情页（非 AsyncView 场景）。 */
const ErrorRetry: Component<ErrorRetryProps> = (props) => {
	return (
		<div
			style={{
				padding: "var(--space-2xl) var(--space-lg)",
				"text-align": "center",
			}}
		>
			<p
				style={{
					color: "var(--t-color-danger)",
					"margin-bottom": "var(--space-md)",
					"font-weight": "500",
				}}
			>
				{props.message ?? "加载失败"}：{getErrorMessage(props.error)}
			</p>
			<Button variant="primary" size="sm" onClick={props.onRetry}>
				重试
			</Button>
		</div>
	);
};

export default ErrorRetry;
