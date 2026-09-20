import { Button, Field, Input } from "@components/ui";
import { Plus, X } from "@components/ui/icons";
import { type Component, For, Show } from "solid-js";
import styles from "../FileDetail.module.css";
import type { MetaEntry, useFileDetail } from "../hooks/useFileDetail.ts";
import TagInput from "./TagInput.tsx";

const MetaRowEditor: Component<{
	entry: MetaEntry;
	index: number;
	onKey: (index: number, value: string) => void;
	onValue: (index: number, value: string) => void;
	onRemove: (index: number) => void;
}> = (props) => (
	<div class={styles.metaEditRow}>
		<Input
			class={styles.metaEditKey}
			placeholder="键"
			value={props.entry.key}
			onInput={(e) => props.onKey(props.index, e.currentTarget.value)}
			aria-label={`元信息键 ${props.index + 1}`}
		/>
		<Input
			class={styles.metaEditValue}
			placeholder="值"
			value={props.entry.value}
			onInput={(e) => props.onValue(props.index, e.currentTarget.value)}
			aria-label={`元信息值 ${props.index + 1}`}
		/>
		<Button
			variant="icon"
			title="删除该行"
			onClick={() => props.onRemove(props.index)}
		>
			<X size={14} />
		</Button>
	</div>
);

/**
 * 侧栏的编辑模式：文件名 / 标签 / 元信息键值对 + 保存取消。
 *
 * 整个 hook 作为 prop 传进来（而不是把 20 多个字段逐个摊开）：表单字段与
 * hook 的编辑态一一对应，摊开会退化成两处都要维护的长参数表。
 */
export default function FileEditForm(props: {
	m: ReturnType<typeof useFileDetail>;
}) {
	const m = props.m;
	return (
		<div class={styles.form}>
			<Field label="文件名">
				<Input
					value={m.name()}
					onInput={(e) => m.setName(e.currentTarget.value)}
				/>
			</Field>
			<span class={styles.label}>标签</span>
			<TagInput tags={m.tags()} onAdd={m.addTag} onRemove={m.removeTag} />
			<span class={styles.label}>元信息</span>
			<For each={m.metaEntries()}>
				{(entry, index) => (
					<MetaRowEditor
						entry={entry}
						index={index()}
						onKey={m.setMetaKey}
						onValue={m.setMetaValue}
						onRemove={m.removeMetaEntry}
					/>
				)}
			</For>
			<Button variant="secondary" size="sm" onClick={m.addMetaEntry}>
				<Plus size={14} /> 添加字段
			</Button>
			<Show when={m.formError()}>
				<div class={styles.formError}>{m.formError()}</div>
			</Show>
			<div class={styles.formActions}>
				<Button variant="secondary" size="sm" onClick={m.cancelEdit}>
					取消
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={m.save}
					disabled={m.saving()}
				>
					{m.saving() ? "保存中…" : "保存"}
				</Button>
			</div>
		</div>
	);
}
