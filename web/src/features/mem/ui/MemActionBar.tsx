import { Show } from "solid-js";
import Button from "../../../components/ui/Button.tsx";
import styles from "./MemDetailPanel.module.css";

interface Props {
	editing: boolean;
	memState: string;
	onStartEdit: () => void;
	onSaveEdit: () => void;
	onCancelEdit: () => void;
	onReset: () => void;
	onSuspend: () => void;
	onUnsuspend: () => void;
	onDelete: () => void;
}

/** 详情面板的操作按钮组：编辑/忘却/挂起/恢复/删除，编辑态切换为保存/取消 */
export default function MemActionBar(props: Props) {
	return (
		<div class={styles.actionBtns}>
			<Show
				when={props.editing}
				fallback={
					<>
						<Button variant="secondary" size="sm" onClick={props.onStartEdit}>
							编辑
						</Button>
						<Button variant="secondary" size="sm" onClick={props.onReset}>
							忘却
						</Button>
						<Show when={props.memState !== "suspended"}>
							<Button variant="secondary" size="sm" onClick={props.onSuspend}>
								挂起
							</Button>
						</Show>
						<Show when={props.memState === "suspended"}>
							<Button variant="secondary" size="sm" onClick={props.onUnsuspend}>
								恢复
							</Button>
						</Show>
						<Button variant="danger" size="sm" onClick={props.onDelete}>
							删除
						</Button>
					</>
				}
			>
				<Button variant="primary" size="sm" onClick={props.onSaveEdit}>
					保存
				</Button>
				<Button variant="secondary" size="sm" onClick={props.onCancelEdit}>
					取消
				</Button>
			</Show>
		</div>
	);
}
