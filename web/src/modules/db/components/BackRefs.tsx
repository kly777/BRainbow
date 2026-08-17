import { getErrorMessage } from "@lib/api";
import { type Component, createResource, For, Show } from "solid-js";
import { getBackRefsE } from "../api";
import styles from "../DbViewer.module.css";

interface BackRefsProps {
	table: string;
	rowKey: string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
}

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
						{(group) => (
							<section class={styles.backrefGroup}>
								<h4 class={styles.backrefGroupTitle}>
									{group.source_table} · {group.column}（{group.total} 行）
								</h4>
								<ul class={styles.backrefList}>
									<For each={group.rows}>
										{(row) => (
											<li>
												<button
													type="button"
													class={styles.backrefItem}
													title={`跳转到 ${group.source_table} 第 ${row.key} 行`}
													onClick={() =>
														props.onJump(
															group.source_table,
															"id",
															String(row.key),
														)
													}
												>
													<span class={styles.backrefKey}>#{row.key}</span>
													<span class={styles.backrefSummary}>
														{row.summary}
													</span>
												</button>
											</li>
										)}
									</For>
								</ul>
							</section>
						)}
					</For>
				</Show>
			</Show>
		</div>
	);
};

export default BackRefs;
