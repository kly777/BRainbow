import {
	AsyncSection,
	Button,
	DetailPage,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { fmtLocal } from "@shared/utils";
import { type Component, Show } from "solid-js";
import styles from "./CardDetail.module.css";
import { useCardDetail } from "./hooks/useCardDetail.ts";

const CardDetailPage: Component = () => {
	const m = useCardDetail();

	return (
		<DetailPage
			class={styles.container}
			title="卡片详情"
			titleHidden
			backLabel="卡片列表"
			onBack={m.handleBack}
			actions={
				<>
					<Button variant="secondary" size="sm" onClick={m.handleEdit}>
						编辑
					</Button>
					<Button variant="danger" size="sm" onClick={m.handleDelete}>
						删除
					</Button>
				</>
			}
		>
			<AsyncSection
				data={m.card}
				loading={m.cardLoading}
				error={m.cardError}
				onRetry={m.refetch}
				class={styles.content}
			>
				{(card) => (
					<Show when={card()} keyed>
						{(cc) => (
							<>
								<div class={styles.meta}>
									{cc.created_at === cc.updated_at ? "创建于" : "修改于"}:{" "}
									{fmtLocal(
										cc.created_at === cc.updated_at
											? cc.created_at
											: cc.updated_at,
									)}
								</div>
								<div class={styles.body}>
									<MarkdownRenderer content={cc.content} />
								</div>
							</>
						)}
					</Show>
				)}
			</AsyncSection>
		</DetailPage>
	);
};

export default CardDetailPage;
