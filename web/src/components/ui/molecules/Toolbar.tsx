import styles from "@components/ui/molecules/Toolbar.module.css";
import { ArrowLeft } from "@components/ui/icons";
import type { Component, JSX } from "solid-js";

interface ToolbarProps {
	title?: string;
	backLabel: string;
	onBack: () => void;
	children?: JSX.Element;
}

const Toolbar: Component<ToolbarProps> = (props) => {
	return (
		<div class={styles.toolbar}>
			<button type="button" class={styles.backBtn} onClick={props.onBack}>
				<ArrowLeft size={16} /> {props.backLabel}
			</button>
			{props.title && <span class={styles.title}>{props.title}</span>}
			{props.children && <div class={styles.actions}>{props.children}</div>}
		</div>
	);
};

export default Toolbar;
