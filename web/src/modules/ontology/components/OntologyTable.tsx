import { For } from "solid-js";
import type { OntologyItem } from "../hooks/useOntologyList.ts";
import styles from "../OntologyList.module.css";
import OntologyDeleteButton from "./OntologyDeleteButton.tsx";

const DESCRIPTION_MAX = 80;

function shorten(description: string | null): string {
	if (!description) return "-";
	return description.length > DESCRIPTION_MAX
		? `${description.substring(0, DESCRIPTION_MAX)}...`
		: description;
}

/** 本体列表视图：ID / 名称 / 描述（截断）/ 操作 */
export default function OntologyTable(props: {
	data: readonly OntologyItem[];
	deletingId: number | null;
	onDelete: (id: number) => void;
}) {
	return (
		<div class={styles.entitiesList}>
			<table class={styles.entitiesTable}>
				<thead>
					<tr>
						<th>ID</th>
						<th>名称</th>
						<th>描述</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.data}>
						{(onto) => (
							<tr>
								<td>{onto.id}</td>
								<td>
									<strong>{onto.name}</strong>
								</td>
								<td class={styles.entityDescription}>
									{shorten(onto.description)}
								</td>
								<td>
									<div class={styles.entityActions}>
										<OntologyDeleteButton
											id={onto.id}
											deletingId={props.deletingId}
											onDelete={props.onDelete}
										/>
									</div>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
}
