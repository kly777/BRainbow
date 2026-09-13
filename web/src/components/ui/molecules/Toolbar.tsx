import Button from "@components/ui/atoms/Button.tsx";
import { ArrowLeft } from "@components/ui/icons";
import styles from "@components/ui/molecules/Toolbar.module.css";
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
			<Button variant="ghost" class={styles.back} onClick={props.onBack}>
				<ArrowLeft size={16} /> {props.backLabel}
			</Button>
			{props.title && <span class={styles.title}>{props.title}</span>}
			{props.children && <div class={styles.actions}>{props.children}</div>}
		</div>
	);
};

export default Toolbar;
