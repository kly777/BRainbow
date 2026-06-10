import { A, useNavigate } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import { deleteCard as apiDeleteCard, getCards } from "../apis/cardApi.ts";
import {
    type CreateTaskRequest,
    getErrorMessage,
} from "../apis/types/index.ts";
import type { CardData } from "../components/card/Card.tsx";
import CardsGrid from "../components/card/CardsGrid.tsx";
import TaskList from "../components/task/TaskList.tsx";
import { TaskProvider, useTasks } from "../components/task/TaskProvider.tsx";
import { AsyncView } from "../components/ui/AsyncView.tsx";
import styles from "./HomePage.module.css";

function TaskSection() {
    const {
        tasks,
        loading,
        add,
        updateStatus,
        removeTask,
        updateTask,
        addSubTask,
    } = useTasks();
    const [title, setTitle] = createSignal("");
    const [desc, setDesc] = createSignal("");

    const handleAdd = async () => {
        if (!title().trim()) return;
        const req: CreateTaskRequest = {
            title: title().trim(),
            description: desc().trim() || undefined,
        };
        setTitle("");
        setDesc("");
        await add(req);
    };

    return (
        <div class={styles.todoSection}>
            <div class={styles.sectionHeader}>
                <h2 class={styles.sectionTitle}>待办事项</h2>
                <div class={styles.sectionActions}>
                    <A href="/tasks" class={styles.viewAllLink}>查看全部 →</A>
                </div>
            </div>

            <div class={styles.addTodoForm}>
                <input
                    type="text"
                    placeholder="输入新任务标题..."
                    value={title()}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                    class={styles.todoInput}
                    onKeyPress={(e) => e.key === "Enter" && handleAdd()}
                />
                <textarea
                    placeholder="任务描述（可选）..."
                    value={desc()}
                    onInput={(e) => setDesc(e.currentTarget.value)}
                    class={styles.todoTextarea}
                />
                <div class={styles.formActions}>
                    <button
                        type="button"
                        onClick={handleAdd}
                        class={styles.addButton}
                        disabled={!title().trim()}
                    >
                        添加任务
                    </button>
                </div>
            </div>

            <Show
                when={tasks().length > 0}
                fallback={
                    <div class={styles.emptyState}>
                        <Show when={!loading()}>
                            <p>暂无待办事项</p>
                            <p class={styles.emptyHint}>
                                添加您的第一个任务吧！
                            </p>
                        </Show>
                        <Show when={loading()}>
                            <p>加载中...</p>
                        </Show>
                    </div>
                }
            >
                <TaskList
                    tasks={tasks()}
                    onStatusChange={updateStatus}
                    onDelete={removeTask}
                    onUpdate={updateTask}
                    onAddSubTask={addSubTask}
                />
            </Show>
        </div>
    );
}

function CardSection() {
    const navigate = useNavigate();
    const [cards, setCards] = createSignal<CardData[]>([]);
    const [loading, setLoading] = createSignal(true);

    const load = async () => {
        setLoading(true);
        try {
            const r = await getCards();
            const sorted = [...r.items].sort((a, b) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime()
            );
            setCards(sorted.slice(0, 4));
        } catch (e) {
            console.error("加载卡片失败:", getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    onMount(load);

    const handleDelete = async (id: number) => {
        if (!confirm("确定要删除这个卡片吗？")) return;
        setCards((c) => c.filter((x) => x.id !== id));
        try {
            await apiDeleteCard(id);
        } catch (e) {
            console.error("删除卡片失败:", getErrorMessage(e));
            await load();
        }
    };

    return (
        <div class={styles.cardsSection}>
            <div class={styles.sectionHeader}>
                <h2 class={styles.sectionTitle}>最近创建的卡片</h2>
                <div class={styles.sectionActions}>
                    <A href="/c" class={styles.viewAllLink}>查看全部 →</A>
                    <A href="/c" class={styles.createLink}>+ 新建卡片</A>
                </div>
            </div>
            <AsyncView
                data={cards()}
                loading={loading()}
                emptyMessage="暂无知识卡片"
            >
                {(data) => (
                    <CardsGrid
                        cards={data}
                        showFilters={false}
                        onCardEdit={(id) => navigate(`/c/edit/${id}`)}
                        onCardDelete={handleDelete}
                        emptyMessage="暂无知识卡片"
                    />
                )}
            </AsyncView>
        </div>
    );
}

const HomePage = () => (
    <div class={styles.homePage}>
        <div class={styles.mainContent}>
            <TaskProvider>
                <TaskSection />
            </TaskProvider>
            <CardSection />
        </div>
    </div>
);

export default HomePage;
