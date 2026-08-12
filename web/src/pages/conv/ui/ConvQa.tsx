import { getConvQaE } from "@entities/conv";
import { getErrorMessage } from "@shared/api";
import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { useBackHref } from "../model/useBackHref.ts";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./ConvTopBar.tsx";
import QaPairList from "./QaPairList.tsx";

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
