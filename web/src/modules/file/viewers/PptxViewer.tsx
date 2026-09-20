import { For, Show } from "solid-js";
import { DocContent } from "./DocContent.tsx";
import { PreviewState } from "./PreviewState.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * .pptx：把每页的标题 / 正文 / 备注铺成卡片。
 *
 * 不做"按版面还原"——幻灯片的价值在内容而不在像素级排版（要看原样可下载），
 * 大纲式呈现反而更好读、也能被浏览器 Ctrl+F 搜到。
 */
export const PptxViewer: ViewerComponent = (props) => (
	<DocContent
		item={props.item}
		kind="slides"
		mismatchNote="这个文件不是幻灯片（服务端给的是别的类型）"
		note={(data) =>
			data.kind === "slides" && data.truncated
				? "只显示了前 100 张幻灯片（下载可查看全部）"
				: undefined
		}
	>
		{(data) => {
			if (data.kind !== "slides") return null;
			if (data.slides.length === 0)
				return <PreviewState message="这份演示文稿里没有幻灯片" />;
			return (
				<ol class={styles.slideList}>
					<For each={data.slides}>
						{(slide, index) => (
							<li class={styles.slideCard}>
								<p class={styles.slideIndex}>第 {index() + 1} 页</p>
								<h3 class={styles.slideTitle}>{slide.title || "（无标题）"}</h3>
								<Show when={slide.lines.length > 0}>
									<ul class={styles.slideLines}>
										<For each={slide.lines}>{(line) => <li>{line}</li>}</For>
									</ul>
								</Show>
								<Show when={slide.notes}>
									<p class={styles.slideNotes}>备注：{slide.notes}</p>
								</Show>
							</li>
						)}
					</For>
				</ol>
			);
		}}
	</DocContent>
);
