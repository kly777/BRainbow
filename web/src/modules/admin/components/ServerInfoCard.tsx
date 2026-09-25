// 服务器卡片：内存 / CPU / 磁盘 / 文件与备份占用（拿不到的显示"—"）——从 AdminPage.tsx 下钻
//
// 口径：后端每一项都是"尽力而为"，读不到就是 null，这里显示 "—" 而不是 0
// （见 modules/admin/system.rs 的约定）。

import { InfoHint } from "@components/ui";
import { Show } from "solid-js";
import styles from "../AdminPage.module.css";
import type { SystemInfo } from "../api.ts";
import {
	formatBackupUsage,
	formatBytes,
	formatDirUsage,
	formatIsoLocal,
	formatUsage,
} from "../utils.ts";

export interface ServerInfoCardProps {
	info: SystemInfo;
}

export default function ServerInfoCard(props: ServerInfoCardProps) {
	return (
		<section class={styles.card}>
			<div class={styles.cardHead}>
				<div class={styles.cardTitleRow}>
					<h2 class={styles.cardTitle}>服务器</h2>
					<InfoHint label="关于服务器信息">
						数据、上传与备份都在同一块盘上（所以磁盘那一格就是数据盘的用量）。
						<br />
						"—"表示这一项读不到：内存、负载与磁盘读的是 Linux 的 /proc 与
						statvfs，后端跑在别的系统上就没有这几项；备份目录没配置时同理。
					</InfoHint>
				</div>
			</div>
			<div class={styles.infoGrid}>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>内存</span>
					<span class={styles.infoValue}>
						<Show when={props.info.server.memory} fallback="—">
							{(mem) => formatUsage(mem().used_bytes, mem().total_bytes)}
						</Show>
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>CPU</span>
					<span class={styles.infoValue}>{props.info.server.cpu_count} 核</span>
					<span class={styles.infoHint}>
						负载{" "}
						<Show when={props.info.server.load} fallback="—">
							{(load) => `${load().one} / ${load().five} / ${load().fifteen}`}
						</Show>
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>磁盘</span>
					<span class={styles.infoValue}>
						<Show when={props.info.server.disk} fallback="—">
							{(disk) => formatUsage(disk().used_bytes, disk().total_bytes)}
						</Show>
					</span>
					<Show when={props.info.server.disk}>
						{(disk) => (
							<span class={styles.infoHint}>
								可用 {formatBytes(disk().free_bytes)}
							</span>
						)}
					</Show>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabelRow}>
						<span class={styles.infoLabel}>备份</span>
						<InfoHint label="关于备份统计">
							部署时自动往备份目录里写数据库快照与代码归档（每类各留 30 天 / 20
							份）， 应用只读这个目录来报数。
							<br />
							没有配置备份目录时这里是"—"（开发机正常如此）：默认按根目录约定取{" "}
							<code>{"{根}"}/backup</code>，也可以用 <code>BACKUP_DIR</code>
							显式指定。
						</InfoHint>
					</span>
					<span class={styles.infoValue}>
						{formatBackupUsage(props.info.server.backups)}
					</span>
					<span class={styles.infoHint}>
						最近{" "}
						{formatIsoLocal(props.info.server.backups?.newest_modified ?? null)}
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>上传文件</span>
					<span class={styles.infoValue}>
						{formatDirUsage(props.info.server.uploads)}
					</span>
					<span class={styles.infoHint}>
						缩略图缓存 {formatDirUsage(props.info.server.thumbs)} · favicon{" "}
						{formatDirUsage(props.info.server.favicons)}
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>数据库文件</span>
					<span class={styles.infoValue}>
						{formatBytes(props.info.db_size_bytes)}
					</span>
					<span class={styles.infoHint}>
						Schema v{props.info.db_version} ·{" "}
						{props.info.db_page_count.toLocaleString()} 页 ×{" "}
						{props.info.db_page_size} B
					</span>
				</div>
			</div>
			{/* 备份目录路径是"状态"，留着；怎么配、为什么是"—"收进上面的 ⓘ */}
			<Show when={props.info.server.backup_dir}>
				{(dir) => <p class={styles.hint}>备份目录：{dir()}</p>}
			</Show>
		</section>
	);
}
