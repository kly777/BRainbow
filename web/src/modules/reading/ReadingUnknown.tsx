import { AsyncView, BackLink, Button } from "@components/ui";
import { Check } from "@components/ui/icons";
import { PATHS } from "@config/paths";
import { listUnknownWords, markWord, type UnknownWord } from "@modules/reading";
import { createResource, For } from "solid-js";
import styles from "./ReadingUnknown.module.css";

const WordCard = (props: {
	w: UnknownWord;
	onMarkKnown: (word: string) => void;
}) => (
	<div class={styles.card}>
		<div class={styles.wordMain}>
			<span class={styles.word}>{props.w.word}</span>
			<span class={styles.counts}>
				不认识 {props.w.unknown_count} 次 / 认识 {props.w.known_count} 次
			</span>
		</div>
		<Button
			variant="primary"
			size="sm"
			onClick={() => props.onMarkKnown(props.w.word)}
		>
			<Check size={14} /> 认识
		</Button>
	</div>
);

export default function ReadingUnknown() {
	const [data, { refetch }] = createResource(listUnknownWords);

	const handleMarkKnown = async (word: string) => {
		await markWord(word, "known");
		refetch();
	};

	return (
		<div class={styles.page}>
			<BackLink href={PATHS.reading} label="文章列表" size={16} />
			<h1>不认识词表</h1>
			<p class={styles.subtitle}>
				按标记「不认识」次数降序排列。点击 <Check size={14} /> 改为认识。
			</p>

			<AsyncView
				data={data()?.words}
				loading={data.loading}
				error={data.error}
				onRetry={refetch}
				emptyMessage="暂无不认识词，去读一篇文章吧"
			>
				{(words) => (
					<div class={styles.list}>
						<For each={words()}>
							{(w) => <WordCard w={w} onMarkKnown={handleMarkKnown} />}
						</For>
					</div>
				)}
			</AsyncView>
		</div>
	);
}
