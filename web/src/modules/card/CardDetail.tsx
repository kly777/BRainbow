import {
	AsyncView,
	Button,
	Markdown as MarkdownRenderer,
	Toolbar,
} from "@components/ui";
import { fmtLocal } from "@shared/utils";
import type { Component } from "solid-js";
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
				{([c]) =>
					c && (
						<div class={styles.content}>
							<div class={styles.meta}>
								{c.created_at === c.updated_at ? "创建于" : "修改于"}:{" "}
								{fmtLocal(
									c.created_at === c.updated_at ? c.created_at : c.updated_at,
								)}
							</div>
							<div class={styles.body}>
								<MarkdownRenderer content={c.content} />
							</div>
						</div>
					)
				}
			</AsyncView>
		</div>
	);
};

export default CardDetailPage;
