import { type Component, createSignal, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { taskApi } from "../api";

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
                const taskId = parseInt(params.id!);
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
        <div class="container">
            <div class="header">
                <h1>{props.editMode ? "编辑任务" : "创建新任务"}</h1>
                <div class="actions">
                    <button class="secondary" onClick={handleCancel}>
                        取消
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="error">{error()}</div>
            </Show>

            <form onSubmit={handleSubmit}>
                <div class="form-group">
                    <label for="title">标题</label>
                    <input
                        id="title"
                        type="text"
                        value={title()}
                        onInput={(e) => setTitle(e.currentTarget.value)}
                        required
                        disabled={loading()}
                        placeholder="输入任务标题"
                    />
                </div>

                <div class="form-group">
                    <label for="description">描述</label>
                    <textarea
                        id="description"
                        value={description()}
                        onInput={(e) => setDescription(e.currentTarget.value)}
                        disabled={loading()}
                        placeholder="输入任务描述"
                        rows={4}
                    />
                </div>

                <div class="form-actions">
                    <button type="submit" disabled={loading()}>
                        <Show
                            when={loading()}
                            fallback={props.editMode ? "更新任务" : "创建任务"}
                        >
                            处理中...
                        </Show>
                    </button>
                    <button
                        type="button"
                        class="secondary"
                        onClick={handleCancel}
                        disabled={loading()}
                    >
                        取消
                    </button>
                </div>
            </form>

            <div class="help-text">
                <p>
                    <strong>提示:</strong>
                </p>
                <ul>
                    <li>标题为必填项</li>
                    <li>描述可以为空</li>
                    <li>创建后可以添加子任务、依赖和时间窗口</li>
                </ul>
            </div>
        </div>
    );
};

export default TaskFormPage;
