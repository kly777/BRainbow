// ── /bookmark/:id：书签详情（全局搜索直达 + AI 标签建议） ──

import { AsyncSection, Button, Toolbar } from "@components/ui";
import { Show } from "solid-js";
import styles from "./BookmarkDetail.module.css";
import BookmarkEditForm from "./components/BookmarkEditForm.tsx";
import BookmarkView from "./components/BookmarkView.tsx";
import { useBookmarkDetail } from "./hooks/useBookmarkDetail.ts";

export default function BookmarkDetail() {
	const m = useBookmarkDetail();

	return (
		<div class={styles.container}>
			<Toolbar backLabel="书签列表" onBack={m.handleBack}>
				<Button
					variant="secondary"
					size="sm"
					onClick={m.startEdit}
					disabled={m.editing()}
				>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={m.remove}>
					删除
				</Button>
			</Toolbar>

			<AsyncSection
				data={m.data}
				loading={() => m.dataLoading}
				error={() => m.dataError}
				refreshing={() => m.dataRefreshing}
				onRetry={m.refetch}
			>
				{(bm) => (
					<div class={styles.card}>
						<Show when={m.editing()} fallback={<BookmarkView bm={bm()} />}>
							<BookmarkEditForm m={m} />
						</Show>
					</div>
				)}
			</AsyncSection>
		</div>
	);
}
