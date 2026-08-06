import { A } from "@solidjs/router";
import { createResource, For } from "solid-js";
import { listUnknownWords, markWord } from "@features/reading/api.ts";
import styles from "@features/reading/ReadingUnknown.module.css";

export default function ReadingUnknown() {
	const [data, { refetch }] = createResource(listUnknownWords);

	const handleMarkKnown = async (word: string) => {
		await markWord(word, "known");
		refetch();
	};

	return (
		<div class={styles.page}>
			<A href="/reading" class={styles.back}>
				← 文章列表
			</A>
			<h1>不认识词表</h1>
			<p class={styles.subtitle}>
				按标记"不认识"次数降序排列。点击 ✓ 改为认识。
			</p>

			<div class={styles.list}>
				<For
					each={data()?.words}
					fallback={
						<div class={styles.empty}>暂无不认识词——开始阅读文章吧</div>
					}
				>
					{(w) => (
						<div class={styles.card}>
							<div class={styles.wordMain}>
								<span class={styles.word}>{w.word}</span>
								<span class={styles.counts}>
									不认识 {w.unknown_count} 次 / 认识 {w.known_count} 次
								</span>
							</div>
							<button
								type="button"
								class={styles.knownBtn}
								onClick={() => handleMarkKnown(w.word)}
							>
								✓ 认识
							</button>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
