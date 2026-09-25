// 开放注册开关（带 role=switch 与 aria-checked）——从 AdminPage.tsx 下钻

import { InfoHint } from "@components/ui";
import styles from "../AdminPage.module.css";

export interface RegistrationCardProps {
	allowRegister: boolean;
	saving: boolean;
	onToggle: () => void;
}

export default function RegistrationCard(props: RegistrationCardProps) {
	return (
		<section class={styles.card}>
			<div class={styles.cardHead}>
				<div class={styles.cardTitleRow}>
					<h2>开放注册</h2>
					<InfoHint label="关于开放注册">
						控制新用户能否自行注册账号。公网部署建议保持关闭 ——
						这台机器只给自己用时，没有理由留着注册入口。
					</InfoHint>
				</div>
				<button
					type="button"
					class={props.allowRegister ? styles.toggleOn : styles.toggleOff}
					classList={{ [styles.disabled]: props.saving }}
					role="switch"
					aria-checked={props.allowRegister}
					disabled={props.saving}
					onClick={() => props.onToggle()}
				>
					<span class={styles.toggleKnob} />
					{props.allowRegister ? "开放" : "关闭"}
				</button>
			</div>
		</section>
	);
}
