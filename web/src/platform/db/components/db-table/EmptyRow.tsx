// 空数据行（从 DbTable.tsx 下钻）

import { EmptyState } from "@components/ui";
import type { Component } from "solid-js";

export interface EmptyRowProps {
	colSpan: number;
}

const EmptyRow: Component<EmptyRowProps> = (props) => (
	<tr>
		<td colspan={props.colSpan}>
			<EmptyState title="无数据" compact />
		</td>
	</tr>
);

export default EmptyRow;
