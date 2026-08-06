import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { getConvQaE } from "@features/conv/api.ts";
import styles from "@features/conv/ConvDetail.module.css";
import { useBackHref } from "@features/conv/logic/useBackHref.ts";
import ConvTopBar from "@features/conv/ui/ConvTopBar.tsx";
import QaPairList from "@features/conv/ui/QaPairList.tsx";

export default function ConvQaPage() {
	const params = useParams();
	const [data] = createResource(
		() => params.id,
		(id) => getConvQaE(Number(id)),
	);
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			<Show when={data()} fallback={<div class={styles.loading}>加载中…</div>}>
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
		</div>
	);
}
