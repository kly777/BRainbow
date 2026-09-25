import { getErrorMessage } from "@shared/api";
import {
	enumParam,
	notifyError,
	notifySuccess,
	showConfirm,
	strParam,
	tryAsync,
	useListResource,
	useModal,
	useUrlParams,
} from "@shared/utils";
import { type Accessor, createSignal, type Setter } from "solid-js";
import { createOntoE, deleteOntoE, getOntosE } from "../api";

export type OntologyItem = Awaited<ReturnType<typeof getOntosE>>[number];

export interface OntologyListApi {
	ontologies: Accessor<readonly OntologyItem[]>;
	/** Accessor（不是值）：见 useListResource 的约定 1 */
	loading: Accessor<boolean>;
	error: Accessor<unknown>;
	refetch: () => void;
	searchQuery: () => string;
	setSearchQuery: (q: string) => void;
	viewMode: () => "grid" | "list";
	setViewMode: (v: "grid" | "list") => void;
	filteredOntologies: () => readonly OntologyItem[];
	showCreateModal: () => boolean;
	newName: () => string;
	setNewName: Setter<string>;
	newDescription: () => string;
	setNewDescription: Setter<string>;
	isCreating: () => boolean;
	createError: () => string;
	deletingOntoId: () => number | null;
	handleCreateOnto: () => Promise<void>;
	handleDeleteOnto: (id: number) => Promise<void>;
	openCreateModal: () => void;
	closeCreateModal: () => void;
}

export function useOntologyList(): OntologyListApi {
	/**
	 * 取数走共享原语（`useListResource` 的数组端点模式）：错误信号、loading、
	 * 乐观更新与回滚都由它负责 —— 这里此前手写了一整套（loadError 信号、
	 * tryAsync 包一层、getter 防冻结、删除的回滚），与 `useFileList` 同源但各写一遍。
	 * 端点无参数，故请求键恒为 null（只拉一次）。
	 */
	const list = useListResource<null, OntologyItem>({
		key: () => null,
		fetcher: () => getOntosE(),
	});

	const params = useUrlParams({
		q: strParam(""),
		view: enumParam(["grid", "list"] as const, "grid"),
	});
	const searchQuery = () => params.get("q");
	const setSearchQuery = (q: string) => params.set({ q });
	const viewMode = () => params.get("view");
	const setViewMode = (v: "grid" | "list") => params.set({ view: v });

	const createModal = useModal();
	const [newName, setNewName] = createSignal("");
	const [newDescription, setNewDescription] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [createError, setCreateError] = createSignal("");
	const [deletingOntoId, setDeletingOntoId] = createSignal<number | null>(null);

	const filteredOntologies = () => {
		const data = list.items();
		if (!searchQuery()) return data;
		const query = searchQuery().toLowerCase();
		return data.filter(
			(onto) =>
				onto.name.toLowerCase().includes(query) ||
				(onto.description ?? "").toLowerCase().includes(query),
		);
	};

	const handleCreateOnto = async () => {
		if (!newName().trim()) {
			setCreateError("名称不能为空");
			return;
		}
		setIsCreating(true);
		setCreateError("");
		const name = newName().trim();
		const description = newDescription().trim() || undefined;
		const result = await tryAsync(() => createOntoE(name, description));
		if (result.ok) {
			setNewName("");
			setNewDescription("");
			createModal.close();
			list.patch((items) => [result.value, ...items]);
			notifySuccess("本体创建成功");
		} else {
			notifyError("创建本体失败", result.error);
			setCreateError(getErrorMessage(result.error));
		}
		setIsCreating(false);
	};

	const handleDeleteOnto = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除本体",
			message: "确定要删除这个本体吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		if (deletingOntoId() === id) return;
		setDeletingOntoId(id);
		// 先本地移除、失败自动回滚（原语负责回滚到操作前快照）
		const res = await list.optimistic(
			(items) => items.filter((onto) => onto.id !== id),
			() => deleteOntoE(id),
		);
		if (res.ok) notifySuccess("本体已删除");
		else notifyError("删除本体失败", res.error);
		setDeletingOntoId(null);
	};

	const openCreateModal = () => {
		setNewName("");
		setNewDescription("");
		setCreateError("");
		createModal.open();
	};

	const closeCreateModal = () => {
		createModal.close();
		setCreateError("");
	};

	return {
		ontologies: list.items,
		loading: list.loading,
		error: list.error,
		refetch: list.refetch,
		searchQuery,
		setSearchQuery,
		viewMode,
		setViewMode,
		filteredOntologies,
		showCreateModal: createModal.isOpen,
		newName,
		setNewName,
		newDescription,
		setNewDescription,
		isCreating,
		createError,
		deletingOntoId,
		handleCreateOnto,
		handleDeleteOnto,
		openCreateModal,
		closeCreateModal,
	};
}
