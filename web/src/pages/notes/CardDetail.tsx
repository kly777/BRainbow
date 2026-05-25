import { useNavigate, useParams } from "@solidjs/router";
import { Effect } from "effect";
import { type Component, createResource } from "solid-js";
import { deleteCard, getCard } from "../../apis/cardApi.ts";
import Markdown from "../../components/ui/Markdown.tsx";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
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
        return await Effect.runPromise(getCard(id));
    });

    const handleDelete = async () => {
        if (!confirm("确定要删除？")) return;
        await Effect.runPromise(
            deleteCard(cardId()).pipe(
                Effect.tap(() => navigate("/c")),
                Effect.catchTag("HttpError", () => Effect.void),
            ),
        );
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
            <div class={styles.toolbar}>
                <button
                    type="button"
                    class={styles.backBtn}
                    onClick={() => navigate("/c")}
                >
                    ← 卡片列表
                </button>
                <div class={styles.toolbarActions}>
                    <button
                        type="button"
                        class={styles.editBtn}
                        onClick={() => navigate(`/c/edit/${cardId()}`)}
                    >
                        编辑
                    </button>
                    <button
                        type="button"
                        class={styles.deleteBtn}
                        onClick={handleDelete}
                    >
                        删除
                    </button>
                </div>
            </div>

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
                                    {c.created_at === c.updated_at ? "创建于" : "修改于"}
                                    : {formatDate(
                                        c.created_at === c.updated_at
                                            ? c.created_at
                                            : c.updated_at,
                                    )}
                                </span>
                            </div>
                            <div class={styles.body}>
                                <Markdown content={c.content} />
                            </div>
                        </div>
                    )}
            </AsyncView>
        </div>
    );
};

export default CardDetailPage;
