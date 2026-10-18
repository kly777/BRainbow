import type { Component } from "solid-js";
import styles from "./ArticleContent.module.css";

interface ArticleContentProps {
	content: string;
	wordStatusMap: () => ReadonlyMap<string, string>;
}

function splitSentences(text: string): string[] {
	return text.split(/(?<=[.!?])\s+/);
}

/** 文章正文渲染：只负责展示，点击/右键由外层容器事件委托处理。 */
const ArticleContent: Component<ArticleContentProps> = (props) => {
	const renderContent = (text: string) =>
		text.split(/\n/).map((para) => {
			if (para.trim().length === 0) return <br />;
			const sentences = splitSentences(para);
			const rendered = sentences.map((sentence) => {
				const tokens = sentence.split(/(\s+)/);
				const renderedTokens = tokens.flatMap((token) =>
					token.split(/([^a-zA-Z'-]+)/).map((part) => {
						const isWord = part.length > 0 && /[a-zA-Z']/.test(part);
						if (!isWord) return part;
						const clean = part.toLowerCase();
						const s = props.wordStatusMap().get(clean);
						const cls =
							s === "known" || s === "ignored"
								? styles.word
								: styles.unknownWord;
						// 非颜色信息通道：title 悬停提示（span 内容即单词文本，屏幕阅读器直接朗读）
						const wordTitle =
							s === "known"
								? "已认识"
								: s === "ignored"
									? "已忽略"
									: "不认识该单词";
						return (
							<span class={cls} data-word={clean} title={wordTitle}>
								{part}
							</span>
						);
					}),
				);
				return <span>{renderedTokens} </span>;
			});
			return <div class={styles.paragraph}>{rendered}</div>;
		});

	return <>{renderContent(props.content)}</>;
};

export default ArticleContent;
