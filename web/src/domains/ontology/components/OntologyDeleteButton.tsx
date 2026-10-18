import { Button } from "@components/ui";

/**
 * 本体条目的删除按钮：列表视图与网格视图共用。
 *
 * 抽出来的原因很直接 —— 两个视图的删除按钮逐字相同（连"删除中..."的三点都
 * 一样），改一处文案要记得改两处。
 */
export default function OntologyDeleteButton(props: {
	id: number;
	deletingId: number | null;
	onDelete: (id: number) => void;
}) {
	const deleting = () => props.deletingId === props.id;
	return (
		<Button
			variant="danger"
			size="sm"
			onClick={() => props.onDelete(props.id)}
			disabled={deleting()}
		>
			{deleting() ? "删除中..." : "删除"}
		</Button>
	);
}
