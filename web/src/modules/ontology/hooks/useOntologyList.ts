import { getErrorMessage } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
	tryOrNotify,
} from "@shared/utils";
import { useSearchParams } from "@solidjs/router";
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
	const [ontologies, { mutate, refetch }] = createResource(async () => {
		const result = await tryAsync(() => getOntosE());
		if (result.ok) return result.value;
		throw result.error;
	});

	const [searchParams, setSearchParams] = useSearchParams();
	const searchQuery = () => {
		const q = searchParams.q;
		if (Array.isArray(q)) return q[0] ?? "";
		return q ?? "";
	};
	const setSearchQuery = (q: string) => setSearchParams({ q: q || undefined });
	const viewMode = () => {
		const v = searchParams.view;
		return (v === "list" ? "list" : "grid") as "grid" | "list";
	};
	const setViewMode = (v: "grid" | "list") =>
		setSearchParams({
			q: searchQuery() || undefined,
			view: v === "grid" ? undefined : v,
		});

	const [showCreateModal, setShowCreateModal] = createSignal(false);
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
			setShowCreateModal(false);
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
		setShowCreateModal(true);
	};

	const closeCreateModal = () => {
		setShowCreateModal(false);
		setCreateError("");
	};

	return {
		ontologies: () => ontologies() ?? [],
		loading: ontologies.loading,
		error: ontologies.error,
		refetch,
		searchQuery,
		setSearchQuery,
		viewMode,
		setViewMode,
		filteredOntologies,
		showCreateModal,
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
