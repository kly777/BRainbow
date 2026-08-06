import type { Component, JSX } from "solid-js";
import styles from "@components/ui/Toolbar.module.css";

interface ToolbarProps {
	title?: string;
	backLabel?: string;
	onBack?: () => void;
	children?: JSX.Element;
}

const Toolbar: Component<ToolbarProps> = (props) => {
	return (
		<div class={styles.toolbar}>
			{props.onBack && (
				<button type="button" class={styles.backBtn} onClick={props.onBack}>
					← {props.backLabel ?? "返回"}
				</button>
			)}
			{props.title && <span class={styles.title}>{props.title}</span>}
			{props.children && <div class={styles.actions}>{props.children}</div>}
		</div>
	);
};

export default Toolbar;
