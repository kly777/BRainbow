// 服务信息卡片（版本 / 运行时长 / 数据库版本与大小）——从 AdminPage.tsx 下钻

import styles from "../AdminPage.module.css";
import type { SystemInfo } from "../api.ts";
import { formatBytes, formatUptime } from "../utils.ts";

export interface ServiceInfoCardProps {
	info: SystemInfo;
}

export default function ServiceInfoCard(props: ServiceInfoCardProps) {
	return (
		<section class={styles.card}>
			<h2 class={styles.cardTitle}>服务信息</h2>
			<div class={styles.infoGrid}>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>版本</span>
					<span class={styles.infoValue}>v{props.info.version}</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>运行时长</span>
					<span class={styles.infoValue}>
						{formatUptime(props.info.uptime_secs)}
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>数据库版本</span>
					<span class={styles.infoValue}>Schema v{props.info.db_version}</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>数据库大小</span>
					<span class={styles.infoValue}>
						{formatBytes(props.info.db_size_bytes)}
					</span>
				</div>
			</div>
		</section>
	);
}
