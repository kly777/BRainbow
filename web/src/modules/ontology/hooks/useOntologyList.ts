import { getErrorMessage } from "@shared/api";
import {
	enumParam,
	notifyError,
	notifySuccess,
	showConfirm,
	strParam,
	tryAsync,
	tryOrNotify,
	useModal,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal, type Setter } from "solid-js";
import { createOntoE, deleteOntoE, getOntosE } from "../api";

export type OntologyItem = Awaited<ReturnType<typeof getOntosE>>[number];

export interface OntologyListApi {
	ontologies: () => readonly OntologyItem[];
	loading: boolean;
	error: Error | undefined;
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
	 * 取数失败单独用信号暴露、不从 fetcher 抛错：抛错会中断 Solid 的响应式更新，
	 * 而本应用没有 ErrorBoundary —— 资源会停在 loading=true，页面永远骨架屏。
	 */
	const [loadError, setLoadError] = createSignal<Error | undefined>(undefined);

	const [ontologies, { mutate, refetch }] = createResource(async () => {
		const result = await tryAsync(() => getOntosE());
		if (result.ok) {
			setLoadError(undefined);
			return result.value;
		}
		setLoadError(result.error);
		return [];
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
		const data = ontologies() || [];
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
			const currentData = ontologies() || [];
			mutate([result.value, ...currentData]);
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
		const currentData = ontologies() || [];
		const ontoToDelete = currentData.find((onto) => onto.id === id);
		if (ontoToDelete) {
			mutate(currentData.filter((onto) => onto.id !== id));
		}
		const ok = await tryOrNotify(() => deleteOntoE(id), "删除本体");
		if (ok) {
			notifySuccess("本体已删除");
		} else {
			if (ontoToDelete) mutate([...currentData]);
		}
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
		ontologies: () => ontologies() ?? [],
		// getter：避免 createResource 创建瞬间 state=pending 被冻结为
		// true 快照，导致 AsyncView 永远骨架屏（与 useFileList 同源修复）
		get loading() {
			return ontologies.loading;
		},
		get error() {
			return loadError();
		},
		refetch,
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
