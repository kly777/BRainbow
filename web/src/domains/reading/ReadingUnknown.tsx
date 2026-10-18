import { AsyncView, BackLink, Button } from "@components/ui";
import { Check } from "@components/ui/icons";
import { PATHS } from "@config/paths";
import { useListResource } from "@shared/utils";
import { For } from "solid-js";
import { listUnknownWords, markWord, type UnknownWord } from "./api.ts";
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
	// 端点是包装数组（{words}），交原语归一成单页列表
	const list = useListResource<null, UnknownWord>({
		key: () => null,
		fetcher: async () => (await listUnknownWords()).words,
	});

	// 标成"认识"后这条就该从不认识词表里消失 —— 乐观移除，失败由原语回滚
	const handleMarkKnown = async (word: string) => {
		await list.optimistic(
			(words) => words.filter((w) => w.word !== word),
			() => markWord(word, "known"),
		);
	};

	return (
		<div class={styles.page}>
			<BackLink href={PATHS.reading} label="文章列表" size={16} />
			<h1>不认识词表</h1>
			<p class={styles.subtitle}>
				按标记「不认识」次数降序排列。点击 <Check size={14} /> 改为认识。
			</p>

			<AsyncView
				data={list.items()}
				loading={list.loading()}
				error={list.error()}
				onRetry={list.refetch}
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
