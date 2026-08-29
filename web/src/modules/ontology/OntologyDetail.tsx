// ── /ontology/:id：本体详情（全局搜索直达） ──

import { Button, ErrorRetry, LoadingSkeleton, Toolbar } from "@components/ui";
import { PATHS } from "@config/paths";
import { notifySuccess, tryOrNotify, confirmAndDelete } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal, Show } from "solid-js";
import { deleteOntoE, getOntoE, updateOntoE } from "./api";
import styles from "./OntologyDetail.module.css";

type EditFormProps = {
	name: string;
	description: string;
	saving: boolean;
	onNameInput: (value: string) => void;
	onDescriptionInput: (value: string) => void;
	onCancel: () => void;
	onSave: () => void;
};

const EditForm = (props: EditFormProps) => (
	<div class={styles.form}>
		<label class={styles.label} for="onto-name">
			名称
		</label>
		<input
			id="onto-name"
			class={styles.input}
			value={props.name}
			onInput={(e) => props.onNameInput(e.currentTarget.value)}
		/>
		<label class={styles.label} for="onto-desc">
			描述
		</label>
		<textarea
			id="onto-desc"
			class={styles.textarea}
			value={props.description}
			onInput={(e) => props.onDescriptionInput(e.currentTarget.value)}
			rows={4}
		/>
		<div class={styles.formActions}>
			<Button variant="secondary" size="sm" onClick={props.onCancel}>
				取消
			</Button>
			<Button
				variant="primary"
				size="sm"
				onClick={props.onSave}
				disabled={props.saving || !props.name.trim()}
			>
				{props.saving ? "保存中…" : "保存"}
			</Button>
		</div>
	</div>
);

export default function OntologyDetail() {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const [data, { refetch }] = createResource(id, (v) => {
		if (!Number.isInteger(v) || v < 1) throw new Error("无效的本体 ID");
		return getOntoE(v);
	});

	const [editing, setEditing] = createSignal(false);
	const [name, setName] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [saving, setSaving] = createSignal(false);

	const startEdit = () => {
		const onto = data();
		if (!onto) return;
		setName(onto.name);
		setDescription(onto.description ?? "");
		setEditing(true);
	};

	const save = async () => {
		const cleanName = name().trim();
		if (!cleanName) return;
		setSaving(true);
		const ok = await tryOrNotify(
			() =>
				updateOntoE(id(), {
					name: cleanName,
					description: description().trim(),
				}),
			"保存本体",
		);
		setSaving(false);
		if (ok) {
			notifySuccess("本体已更新");
			setEditing(false);
			refetch();
		}
	};

	const remove = async () => {
		await confirmAndDelete({
			title: "删除本体",
			message: "确定删除这个本体？此操作不可撤销。",
			deleteFn: () => deleteOntoE(id()),
			onSuccess: () => navigate(PATHS.ontology),
		});
	};

	return (
		<div class={styles.container}>
			<Toolbar
				title={data()?.name}
				backLabel="本体列表"
				onBack={() => navigate(PATHS.ontology)}
			>
				<Button
					variant="secondary"
					size="sm"
					onClick={startEdit}
					disabled={editing()}
				>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={remove}>
					删除
				</Button>
			</Toolbar>

			<Show when={data.error}>
				<ErrorRetry error={data.error} onRetry={refetch} />
			</Show>

			<Show when={data.loading}>
				<LoadingSkeleton />
			</Show>

			<Show when={data()}>
				{(onto) => (
					<div class={styles.card}>
						<Show
							when={editing()}
							fallback={
								<>
									<div class={styles.head}>
										<h1 class={styles.title}>{onto().name}</h1>
										<span class={styles.meta}>ID: {onto().id}</span>
									</div>
									<p class={styles.description}>
										{onto().description || "暂无描述"}
									</p>
								</>
							}
						>
							<EditForm
								name={name()}
								description={description()}
								saving={saving()}
								onNameInput={(value) => setName(value)}
								onDescriptionInput={(value) => setDescription(value)}
								onCancel={() => setEditing(false)}
								onSave={save}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
