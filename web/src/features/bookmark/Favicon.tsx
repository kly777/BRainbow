/**
 * 书签 favicon：优先显示网站图标，加载失败回退为域名首字母。
 */
import { createSignal, Show } from "solid-js";
import styles from "@features/bookmark/Favicon.module.css";

interface Props {
	url: string;
	/** 回退用首字母 */
	letter: string;
}

export default function Favicon(props: Props) {
	const [failed, setFailed] = createSignal(false);

	return (
		<Show
			when={!failed()}
			fallback={
				<span class={styles.letter} aria-hidden="true">
					{props.letter.charAt(0).toUpperCase()}
				</span>
			}
		>
			<img
				class={styles.img}
				src={`/api/bookmarks/favicon?url=${encodeURIComponent(props.url)}`}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				onError={() => setFailed(true)}
			/>
		</Show>
	);
}
