import {
	AsyncView,
	Button,
	Markdown as MarkdownRenderer,
	Toolbar,
} from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
import { showConfirm, tryOrNotify } from "@lib/utils";
import { deleteCardE, getCardE } from "@modules/card";
import { useNavigate, useParams } from "@solidjs/router";
import { type Component, createResource } from "solid-js";
import styles from "./CardDetail.module.css";

const CardDetailPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();

	const cardId = () => {
		const id = params.id;
		if (!id || !/^\d+$/.test(id)) return NaN;
		return parseInt(id, 10);
	};

	const [card, { refetch }] = createResource(async () => {
		const id = cardId();
		if (Number.isNaN(id)) throw new Error("无效ID");
		return await getCardE(id);
	});

	const handleDelete = async () => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteCardE(cardId()), "删除卡片");
		if (ok) navigate(PATHS.card);
	};

	const formatDate = (s: string) => {
		try {
			return new Date(s).toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return s;
		}
	};

	return (
		<div class={styles.container}>
			<Toolbar backLabel="卡片列表" onBack={() => navigate(PATHS.card)}>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => navigate(fillPath(PATHS.cardEdit, cardId()))}
				>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={handleDelete}>
					删除
				</Button>
			</Toolbar>

			<AsyncView
				data={card() ? [card()] : []}
				loading={card.loading}
				error={card.error}
				onRetry={refetch}
			>
				{([c]) =>
					c && (
						<div class={styles.content}>
							<div class={styles.meta}>
								<span>
									{c.created_at === c.updated_at ? "创建于" : "修改于"}:{" "}
									{formatDate(
										c.created_at === c.updated_at ? c.created_at : c.updated_at,
									)}
								</span>
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
