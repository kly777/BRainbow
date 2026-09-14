import Button from "@components/ui/atoms/Button.tsx";
import styles from "@components/ui/molecules/ErrorRetry.module.css";
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
		<div class={styles.wrap}>
			<p class={styles.text}>
				{props.message ?? "加载失败"}：{getErrorMessage(props.error)}
			</p>
			<Button variant="primary" size="sm" onClick={props.onRetry}>
				重试
			</Button>
		</div>
	);
};

export default ErrorRetry;
