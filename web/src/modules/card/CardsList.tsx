import { fillPath, PATHS } from "@config/paths";
// ── 卡片列表页面（薄壳视图层）──

import {
	AsyncView,
	Button,
	Markdown as MarkdownRenderer,
	Modal,
} from "@components/ui";
import { tryAsync } from "@lib/utils";
import { CardsGrid, getCardsE, searchCardsE } from "@modules/card";
import { useNavigate } from "@solidjs/router";
import { onMount, Show } from "solid-js";
import styles from "./CardsList.module.css";

import { useCardsList } from "./hooks/useCardsList.ts";

export default function CardsListPage() {
	const navigate = useNavigate();
	const m = useCardsList();

	const loadInitial = async () => {
		m.setLoading(true);
		m.setError(null);
		const q = m.searchQuery();
		const result = await tryAsync(() =>
			q ? searchCardsE(q, 1) : getCardsE(1),
		);
		if (result.ok) {
			m.setCards(result.value.items);
			m.setPage(result.value.page);
			m.setTotalPages(result.value.total_pages);
		} else {
			m.setError(result.error);
		}
		m.setLoading(false);
	};

	onMount(loadInitial);

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>卡片列表</h1>
				<div class={styles.actions}>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => navigate(PATHS.cardAdd)}
					>
						＋ 新建
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => {
							m.setShowCreateModal(true);
						}}
					>
						快速创建
					</Button>
				</div>
			</div>

			<AsyncView
				data={m.loading() ? undefined : (m.cards() ?? [])}
				loading={m.loading()}
				error={m.error()}
				onRetry={loadInitial}
				emptyMessage={
					m.isSearchMode()
						? "没有找到匹配的卡片"
						: "还没有卡片，点击上方按钮创建一个吧！"
				}
			>
				{(cards) => (
					<CardsGrid
						cards={[...cards]}
						showFilters
						onSearch={m.handleSearch}
						onLoadMore={m.handleLoadMore}
						loadingMore={m.loadingMore()}
						initialSearchQuery={m.searchQuery()}
						onCardClick={(id) => navigate(fillPath(PATHS.cardDetail, id))}
						onCardEdit={(id) => navigate(fillPath(PATHS.cardEdit, id))}
						onCardDelete={m.handleCardDelete}
						emptyMessage={
							m.isSearchMode()
								? "没有找到匹配的卡片"
								: "还没有卡片，点击上方按钮创建一个吧！"
						}
						deletingCardId={m.deletingCardId()}
					/>
				)}
			</AsyncView>

			<Modal
				isOpen={m.showCreateModal()}
				onClose={() => m.setShowCreateModal(false)}
				title="创建新卡片"
				actions={
					<>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => m.setShowCreateModal(false)}
							disabled={m.isCreating()}
						>
							取消
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={m.handleCreateCard}
							disabled={m.isCreating()}
						>
							{m.isCreating() ? "创建中..." : "创建"}
						</Button>
					</>
				}
			>
				<Show when={m.modalError()}>
					<div class={styles.errorMessage}>{m.modalError()}</div>
				</Show>
				<div class={styles.formGroup}>
					<label for="card-content" class={styles.formLabel}>
						内容
					</label>
					<textarea
						id="card-content"
						class={styles.formTextarea}
						value={m.newCardContent()}
						onInput={(e) => m.setNewCardContent(e.currentTarget.value)}
						placeholder="请输入卡片内容（支持 Markdown）"
						rows={6}
						disabled={m.isCreating()}
					/>
				</div>
				<Show when={m.newCardContent().trim()}>
					<div class={styles.previewSection}>
						<span class={styles.previewLabel}>预览</span>
						<div class={styles.previewContent}>
							<MarkdownRenderer content={m.newCardContent()} />
						</div>
					</div>
				</Show>
			</Modal>
		</div>
	);
}
