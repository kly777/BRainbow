import { For } from "solid-js";
import MarkdownRenderer from "../../../components/ui/Markdown.tsx";
import styles from "../ConvDetail.module.css";

interface QaPair {
	question: string;
	answer: string;
}

interface Props {
	pairs: QaPair[];
}

/** QA 对话记录列表（详情页和 QA 页共用） */
export default function QaPairList(props: Props) {
	return (
		<div class={styles.qaSection}>
			<h2 class={styles.sectionTitle}>对话记录</h2>
			<For each={props.pairs}>
				{(qa) => (
					<div class={styles.qaBlock}>
						<div class={styles.question}>
							<span class={styles.qLabel}>Q</span>
							<div class={styles.md}>
								<MarkdownRenderer content={qa.question} />
							</div>
						</div>
						<div class={styles.answer}>
							<span class={styles.aLabel}>A</span>
							<div class={styles.md}>
								<MarkdownRenderer content={qa.answer} />
							</div>
						</div>
					</div>
				)}
			</For>
		</div>
	);
}
