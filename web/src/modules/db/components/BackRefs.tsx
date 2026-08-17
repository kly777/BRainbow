import { getErrorMessage } from "@lib/api";
import { type Component, createResource, For, Show } from "solid-js";
import { getBackRefsE } from "../api";
import styles from "../DbViewer.module.css";

interface BackRefsProps {
	table: string;
	rowKey: string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
}

type BackRefGroups = Awaited<ReturnType<typeof getBackRefsE>>;
type BackRefGroupItem = BackRefGroups[number];
type BackRefRowItem = BackRefGroupItem["rows"][number];

interface BackRefGroupProps {
	group: BackRefGroupItem;
	onJump: BackRefsProps["onJump"];
}

interface BackRefRowProps {
	group: BackRefGroupItem;
	row: BackRefRowItem;
	onJump: BackRefsProps["onJump"];
}

const BackRefRow: Component<BackRefRowProps> = (props) => (
	<li>
		<button
			type="button"
			class={styles.backrefItem}
			title={`跳转到 ${props.group.source_table} 第 ${props.row.key} 行`}
			onClick={() =>
				props.onJump(props.group.source_table, "id", String(props.row.key))
			}
		>
			<span class={styles.backrefKey}>#{props.row.key}</span>
			<span class={styles.backrefSummary}>{props.row.summary}</span>
		</button>
	</li>
);

const BackRefGroup: Component<BackRefGroupProps> = (props) => (
	<section class={styles.backrefGroup}>
		<h4 class={styles.backrefGroupTitle}>
			{props.group.source_table} · {props.group.column}（{props.group.total}{" "}
			行）
		</h4>
		<ul class={styles.backrefList}>
			<For each={props.group.rows}>
				{(row) => (
					<BackRefRow group={props.group} row={row} onJump={props.onJump} />
				)}
			</For>
		</ul>
	</section>
);

const BackRefs: Component<BackRefsProps> = (props) => {
	const [backrefs] = createResource(
		() => props.rowKey,
		(key) => {
			const id = Number(key);
			return Number.isInteger(id) && id >= 1
				? getBackRefsE(props.table, id)
				: Promise.resolve([]);
		},
	);

	return (
		<div class={styles.backrefs}>
			<Show when={backrefs.loading}>
				<div class={styles.backrefLoading}>正在查找反向引用…</div>
			</Show>
			<Show when={backrefs.error}>
				<div class={styles.backrefError}>{getErrorMessage(backrefs.error)}</div>
			</Show>
			<Show when={!backrefs.loading && !backrefs.error}>
				<Show
					when={(backrefs() ?? []).length > 0}
					fallback={<div class={styles.backrefEmpty}>没有其他表引用这一行</div>}
				>
					<For each={backrefs() ?? []}>
						{(group) => <BackRefGroup group={group} onJump={props.onJump} />}
					</For>
				</Show>
			</Show>
		</div>
	);
};

export default BackRefs;
