import { useNavigate, useParams } from "@solidjs/router";
import { type Component, createSignal, Show } from "solid-js";
import { taskApi } from "../api";
import styles from "../styles/taskForm.module.css";

const TaskFormPage: Component<{ editMode?: boolean }> = (props) => {
	const params = useParams();
	const navigate = useNavigate();

	const [title, setTitle] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setLoading(true);

		try {
			if (props.editMode) {
				if (!params.id) {
					throw new Error("任务ID不能为空");
				}
				const taskId = parseInt(params.id, 10);
				await taskApi.updateTask(taskId, {
					title: title(),
					description: description() || null,
				});
			} else {
				await taskApi.createTask({
					title: title(),
					description: description() || null,
				});
			}
			setError(null);
			navigate("/");
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: props.editMode
						? "更新任务失败"
						: "创建任务失败",
			);
			console.error("Form submission error:", err);
		} finally {
			setLoading(false);
		}
	};

	const handleCancel = () => {
		navigate("/");
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1>{props.editMode ? "编辑任务" : "创建新任务"}</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.secondaryButton}
						onClick={handleCancel}
					>
						取消
					</button>
				</div>
			</div>

			<Show when={error()}>
				<div class={styles.error}>{error()}</div>
			</Show>

			<form class={styles.form} onSubmit={handleSubmit}>
				<div class={styles.formGroup}>
					<label for="title" class={styles.formLabel}>
						标题<span class={styles.required}></span>
					</label>
					<input
						id="title"
						type="text"
						class={styles.formInput}
						value={title()}
						onInput={(e) => setTitle(e.currentTarget.value)}
						required
						disabled={loading()}
						placeholder="输入任务标题"
					/>
				</div>

				<div class={styles.formGroup}>
					<label for="description" class={styles.formLabel}>
						描述
					</label>
					<textarea
						id="description"
						class={styles.formTextarea}
						value={description()}
						onInput={(e) => setDescription(e.currentTarget.value)}
						disabled={loading()}
						placeholder="输入任务描述"
						rows={4}
					/>
				</div>

				<div class={styles.formActions}>
					<button
						type="submit"
						class={styles.primaryButton}
						disabled={loading()}
					>
						<Show
							when={loading()}
							fallback={props.editMode ? "更新任务" : "创建任务"}
						>
							处理中...
						</Show>
					</button>
					<button
						type="button"
						class={styles.secondaryButton}
						onClick={handleCancel}
						disabled={loading()}
					>
						取消
					</button>
				</div>
			</form>
		</div>
	);
};

export default TaskFormPage;
