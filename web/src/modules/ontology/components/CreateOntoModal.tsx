// ── 创建本体模态框（复用全局 Modal/Button，样式集中在 OntologyList.module.css） ──

import { Button, Modal } from "@components/ui";
import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";
import styles from "../OntologyList.module.css";

export function CreateOntoModal(props: {
	open: Accessor<boolean>;
	name: Accessor<string>;
	setName: Setter<string>;
	description: Accessor<string>;
	setDescription: Setter<string>;
	creating: Accessor<boolean>;
	error: Accessor<string>;
	onCreate: () => void;
	onClose: () => void;
}) {
	return (
		<Modal
			isOpen={props.open()}
			onClose={props.onClose}
			title="创建新本体"
			actions={
				<>
					<Button
						variant="secondary"
						onClick={props.onClose}
						disabled={props.creating()}
					>
						取消
					</Button>
					<Button
						variant="primary"
						onClick={props.onCreate}
						disabled={props.creating()}
					>
						{props.creating() ? "创建中..." : "创建"}
					</Button>
				</>
			}
		>
			<Show when={props.error()}>
				<div class={styles.formError}>{props.error()}</div>
			</Show>

			<div class={styles.formGroup}>
				<label for="onto-name" class={styles.formLabel}>
					名称
				</label>
				<input
					id="onto-name"
					type="text"
					class={styles.formInput}
					value={props.name()}
					onInput={(e) => props.setName(e.currentTarget.value)}
					placeholder="请输入本体名称"
					disabled={props.creating()}
				/>
			</div>

			<div class={styles.formGroup}>
				<label for="onto-description" class={styles.formLabel}>
					描述
				</label>
				<textarea
					id="onto-description"
					class={styles.formTextarea}
					value={props.description()}
					onInput={(e) => props.setDescription(e.currentTarget.value)}
					placeholder="请输入本体描述（可选）"
					rows={4}
					disabled={props.creating()}
				/>
			</div>
		</Modal>
	);
}
