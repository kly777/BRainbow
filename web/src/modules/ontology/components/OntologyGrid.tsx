import { For } from "solid-js";
import type { OntologyItem } from "../hooks/useOntologyList.ts";
import styles from "../OntologyList.module.css";
import OntologyDeleteButton from "./OntologyDeleteButton.tsx";

/** 本体网格视图：名称 + ID + 描述 + 操作 */
export default function OntologyGrid(props: {
	data: readonly OntologyItem[];
	deletingId: number | null;
	onDelete: (id: number) => void;
}) {
	return (
		<div class={styles.entitiesGrid}>
			<For each={props.data}>
				{(onto) => (
					<div class={styles.entityCard}>
						<div class={styles.entityHeader}>
							<h3 class={styles.entityName}>{onto.name}</h3>
							<span class={styles.entityType}>ID: {onto.id}</span>
						</div>
						<p class={styles.entityDescription}>
							{onto.description || "暂无描述"}
						</p>
						<div class={styles.entityActions}>
							<OntologyDeleteButton
								id={onto.id}
								deletingId={props.deletingId}
								onDelete={props.onDelete}
							/>
						</div>
					</div>
				)}
			</For>
		</div>
	);
}
