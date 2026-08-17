import {
	dismissToast,
	type ToastItem,
	toasts,
} from "@components/ui/organisms/toastStore.ts";
import { type Component, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./Toast.module.css";

const TYPE_CLASS: Record<ToastItem["type"], string> = {
	error: styles.error,
	warning: styles.warning,
	success: styles.success,
	info: styles.info,
};

function iconForType(type: ToastItem["type"]): string {
	switch (type) {
		case "error":
			return "✕";
		case "warning":
			return "⚠";
		case "success":
			return "✓";
		case "info":
			return "ℹ";
	}
}

const ToastCard: Component<{ toast: ToastItem }> = (props) => (
	<div
		classList={{
			[styles.toast]: true,
			[TYPE_CLASS[props.toast.type]]: true,
			[styles.leaving]: props.toast.leaving,
		}}
		role="alert"
	>
		<div class={styles.body}>
			<span class={styles.icon}>{iconForType(props.toast.type)}</span>
			<div class={styles.content}>
				<div class={styles.title}>
					{props.toast.details ? (
						<>
							{props.toast.title}
							<code class={styles.code}>{props.toast.details}</code>
						</>
					) : (
						props.toast.title
					)}
				</div>
				<Show when={props.toast.message}>
					<div class={styles.message}>{props.toast.message}</div>
				</Show>
			</div>
		</div>
		<button
			type="button"
			class={styles.close}
			onClick={() => dismissToast(props.toast.id)}
			aria-label="关闭通知"
		>
			✕
		</button>
		{/* 倒计时进度条 */}
		<Show when={props.toast.duration > 0}>
			<div
				class={styles.progress}
				style={{
					"animation-duration": `${props.toast.duration}ms`,
				}}
			/>
		</Show>
	</div>
);

export default function ToastContainer() {
	return (
		<Show when={toasts().length > 0}>
			<Portal>
				<div class={styles.container} aria-live="polite" role="status">
					<For each={toasts()}>{(toast) => <ToastCard toast={toast} />}</For>
				</div>
			</Portal>
		</Show>
	);
}
