// JWT 密钥卡片：持久化状态 + 轮换（轮换会让所有会话失效，故在页面侧二次确认）
// ——从 AdminPage.tsx 下钻

import { Button, InfoHint } from "@components/ui";
import styles from "../AdminPage.module.css";

export interface JwtCardProps {
	jwtSecretSet: boolean;
	jwtSecretLen: number;
	rotating: boolean;
	onRotate: () => void;
}

export default function JwtCard(props: JwtCardProps) {
	return (
		<section class={styles.card}>
			<div class={styles.cardHead}>
				<div>
					<h2>JWT 密钥</h2>
					<p class={styles.desc}>
						状态：
						{props.jwtSecretSet
							? `已持久化（${props.jwtSecretLen} 字符）`
							: "未持久化（环境变量或随机密钥，重启后会话失效）"}
					</p>
				</div>
				<div class={styles.cardTitleRow}>
					<Button
						variant="danger"
						size="sm"
						disabled={props.rotating}
						onClick={() => props.onRotate()}
					>
						{props.rotating ? "轮换中…" : "轮换密钥"}
					</Button>
					<InfoHint label="关于轮换密钥">
						轮换后所有现有登录会话立即失效，需要重新登录。
					</InfoHint>
				</div>
			</div>
		</section>
	);
}
