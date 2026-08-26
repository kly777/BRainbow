import {
	AsyncView,
	Button,
	Markdown as MarkdownRenderer,
	Toolbar,
} from "@components/ui";
import { fmtLocal } from "@shared/utils";
import { type Component, Show } from "solid-js";
import styles from "./CardDetail.module.css";
import { useCardDetail } from "./hooks/useCardDetail.ts";

const CardDetailPage: Component = () => {
	const m = useCardDetail();

	return (
		<div class={styles.container}>
			<Toolbar backLabel="卡片列表" onBack={m.handleBack}>
				<Button variant="secondary" size="sm" onClick={m.handleEdit}>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={m.handleDelete}>
					删除
				</Button>
			</Toolbar>

			<AsyncView
				data={m.card() ? [m.card()] : []}
				loading={m.cardLoading}
				error={m.cardError}
				onRetry={m.refetch}
			>
				{(data) => {
					const c = () => data()[0];
					return (
						<Show when={c()} keyed>
							{(cc) => (
								<div class={styles.content}>
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
								</div>
							)}
						</Show>
					);
				}}
			</AsyncView>
		</div>
	);
};

export default CardDetailPage;
