import { type Component, createSignal, For, onMount } from "solid-js";
import { Effect } from "effect";
import { type ColumnInfo, getTableData, getTables } from "../apis/dbApi.ts";
import { getErrorMessage } from "../apis/types/index.ts";

const DB: Component = () => {
    const [tables, setTables] = createSignal<string[]>([]);
    const [activeTable, setActiveTable] = createSignal("");
    const [columns, setColumns] = createSignal<ColumnInfo[]>([]);
    const [rows, setRows] = createSignal<string[][]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");

    const loadTables = async () => {
        setLoading(true);
        try {
            const result = await Effect.runPromise(getTables());
            setTables([...result]);
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    const loadTable = async (name: string) => {
        setActiveTable(name);
        setLoading(true);
        setError("");
        try {
            const result = await Effect.runPromise(getTableData(name));
            setColumns([...result.header]);
            setRows(result.rows.map((row) => row.map((v) => String(v ?? ""))));
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    onMount(() => loadTables());

    return (
        <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
            <div
                style={{
                    width: "180px",
                    "flex-shrink": "0",
                    "overflow-y": "auto",
                    padding: "10px",
                    background: "var(--color-bg)",
                    "border-right": "1px solid var(--color-border-light)",
                }}
            >
                <div
                    style={{
                        "font-weight": "600",
                        padding: "6px 8px",
                        "font-size": "13px",
                        color: "var(--color-text-secondary)",
                    }}
                >
                    表列表
                </div>
                <For each={tables()}>
                    {(t) => (
                        <button
                            type="button"
                            onClick={() => loadTable(t)}
                            style={{
                                display: "block",
                                width: "100%",
                                padding: "8px 12px",
                                cursor: "pointer",
                                "font-size": "13px",
                                "border-radius": "6px",
                                color: "var(--color-text)",
                                "text-align": "left",
                                background: activeTable() === t
                                    ? "var(--color-accent-subtle)"
                                    : "transparent",
                                border: "none",
                            }}
                        >
                            {t}
                        </button>
                    )}
                </For>
            </div>

            <div style={{ flex: "1", overflow: "auto", padding: "16px 20px" }}>
                {error() && (
                    <div
                        style={{
                            padding: "10px",
                            background: "var(--color-danger-subtle)",
                            color: "var(--color-danger)",
                            "border-radius": "6px",
                            "font-size": "13px",
                            "margin-bottom": "12px",
                        }}
                    >
                        {error()}
                    </div>
                )}
                {loading() && (
                    <div
                        style={{
                            color: "var(--color-text-secondary)",
                            padding: "12px",
                        }}
                    >
                        加载中...
                    </div>
                )}

                {activeTable() && !loading() && columns().length > 0 && (
                    <>
                        <h3 style={{ margin: "0 0 10px" }}>{activeTable()}</h3>
                        <div style={{ "overflow-x": "auto" }}>
                            <table
                                style={{
                                    "border-collapse": "collapse",
                                    width: "100%",
                                    "font-size": "13px",
                                }}
                            >
                                <thead>
                                    <tr>
                                        <For each={columns()}>
                                            {(c) => (
                                                <th
                                                    style={{
                                                        padding: "6px 10px",
                                                        "text-align": "left",
                                                        background:
                                                            "var(--color-bg)",
                                                        "border-bottom":
                                                            "2px solid var(--color-border-light)",
                                                        "white-space": "nowrap",
                                                    }}
                                                >
                                                    <div style="font-weight:600">
                                                        {c.name}
                                                    </div>
                                                    <div style="font-size:10px;font-weight:400;color:var(--color-text-muted)">
                                                        {c.col_type}
                                                    </div>
                                                </th>
                                            )}
                                        </For>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows().length === 0 && (
                                        <tr>
                                            <td
                                                colspan={columns().length}
                                                style={{
                                                    padding: "20px",
                                                    color:
                                                        "var(--color-text-muted)",
                                                    "text-align": "center",
                                                }}
                                            >
                                                无数据
                                            </td>
                                        </tr>
                                    )}
                                    <For each={rows()}>
                                        {(row) => (
                                            <tr>
                                                <For each={row}>
                                                    {(cell) => (
                                                        <td
                                                            style={{
                                                                padding:
                                                                    "4px 10px",
                                                                "border-bottom":
                                                                    "1px solid var(--color-border-light)",
                                                                "white-space":
                                                                    "nowrap",
                                                                "max-width":
                                                                    "300px",
                                                                overflow:
                                                                    "hidden",
                                                                "text-overflow":
                                                                    "ellipsis",
                                                            }}
                                                        >
                                                            {String(cell)}
                                                        </td>
                                                    )}
                                                </For>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default DB;
