// ── 卡片列表页面（薄壳视图层）──

import { useNavigate } from "@solidjs/router";
import { onMount, Show } from "solid-js";
import Button from "../../components/ui/Button.tsx";
import MarkdownRenderer from "../../components/ui/Markdown.tsx";
import { tryAsync } from "../../lib/result.ts";
import { getCardsE, searchCardsE } from "./api.ts";
import styles from "./CardsList.module.css";
import { useCardsList } from "./logic/useCardsList.ts";
import CardsGrid from "./ui/CardsGrid.tsx";

export default function CardsListPage() {
	const navigate = useNavigate();
	const m = useCardsList();

	onMount(async () => {
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
	});

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>卡片列表</h1>
				<div class={styles.actions}>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => navigate("/c/add")}
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

			<Show when={m.loading()}>
				<div class={styles.state}>加载中...</div>
			</Show>
			<Show when={m.error()}>
				<div class={styles.state}>
					<p class={styles.errorText}>加载失败</p>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => globalThis.location.reload()}
					>
						重试
					</Button>
				</div>
			</Show>
			<Show when={!m.loading() && !m.error()}>
				<CardsGrid
					cards={[...(m.cards() || [])]}
					showFilters
					onSearch={m.handleSearch}
					onLoadMore={m.handleLoadMore}
					loadingMore={m.loadingMore()}
					initialSearchQuery={m.searchQuery()}
					onCardClick={(id) => navigate(`/c/${id}`)}
					onCardEdit={(id) => navigate(`/c/edit/${id}`)}
					onCardDelete={m.handleCardDelete}
					emptyMessage={
						m.isSearchMode()
							? "没有找到匹配的卡片"
							: "还没有卡片，点击上方按钮创建一个吧！"
					}
					deletingCardId={m.deletingCardId()}
				/>
			</Show>

			<Show when={m.showCreateModal()}>
				<div
					class={styles.modalOverlay}
					onClick={() => m.setShowCreateModal(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") m.setShowCreateModal(false);
					}}
					role="dialog"
					aria-modal="true"
					aria-label="创建新卡片"
					tabIndex={-1}
				>
					<div
						class={styles.modal}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") m.setShowCreateModal(false);
						}}
						role="document"
						tabIndex={-1}
					>
						<div class={styles.modalHeader}>
							<h2>创建新卡片</h2>
							<Button
								variant="icon"
								onClick={() => m.setShowCreateModal(false)}
								title="关闭"
							>
								×
							</Button>
						</div>
						<div class={styles.modalContent}>
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
						</div>
						<div class={styles.modalActions}>
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
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
}
