import { getConvQaE } from "@entities/conv/api.ts";
import styles from "@pages/conv/ConvDetail.module.css";
import { useBackHref } from "@pages/conv/logic/useBackHref.ts";
import ConvTopBar from "@pages/conv/ui/ConvTopBar.tsx";
import QaPairList from "@pages/conv/ui/QaPairList.tsx";
import { getErrorMessage } from "@shared/api/types/errors.ts";
import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";

export default function ConvQaPage() {
	const params = useParams();
	const [data] = createResource(
		() => params.id,
		(id) => getConvQaE(Number(id)),
	);
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			{/* 错误时短路：data() 在 error 存在时会 throw（Solid 1.9 语义） */}
			<Show
				when={data.error}
				fallback={
					<Show
						when={data()}
						fallback={<div class={styles.loading}>加载中…</div>}
					>
						{(d) => (
							<>
								<ConvTopBar
									title={d().title}
									type={d().conv_type}
									date={d().created_at.slice(0, 10)}
									backHref={backHref()}
								/>
								<div class={styles.body}>
									<QaPairList pairs={d().qa_pairs} />
								</div>
							</>
						)}
					</Show>
				}
			>
				<div class={styles.errorMsg}>{getErrorMessage(data.error)}</div>
			</Show>
		</div>
	);
}
