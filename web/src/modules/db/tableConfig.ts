import type { FilterOpValue } from "./api";

export const PAGE_SIZES = [20, 50, 100, 200] as const;

export const FILTER_OPS: readonly { value: FilterOpValue; label: string }[] = [
	{ value: "contains", label: "包含" },
	{ value: "eq", label: "=" },
	{ value: "ne", label: "≠" },
	{ value: "prefix", label: "前缀" },
	{ value: "gt", label: ">" },
	{ value: "lt", label: "<" },
	{ value: "null", label: "为空" },
	{ value: "notnull", label: "非空" },
];

export interface ColumnFilter {
	col: string;
	op: FilterOpValue;
	val: string;
}

export const isFilterOp = (value: string): value is FilterOpValue =>
	FILTER_OPS.some((op) => op.value === value);

export const isValuelessOp = (op: FilterOpValue): boolean =>
	op === "null" || op === "notnull";

export const filterOpLabel = (op: string): string =>
	FILTER_OPS.find((item) => item.value === op)?.label ?? op;

const queryArray = (value: unknown): string[] => {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
};

/** 从 URL 参数（string | string[]）解析对齐的 fcol/fop/fval 三列。 */
export const filtersFromParams = (
	fcol: unknown,
	fop: unknown,
	fval: unknown,
): ColumnFilter[] => {
	const cols = queryArray(fcol);
	const ops = queryArray(fop);
	const vals = queryArray(fval);
	return cols.map((col, index) => {
		const rawOp = ops[index] ?? "contains";
		return {
			col,
			op: isFilterOp(rawOp) ? rawOp : "contains",
			val: vals[index] ?? "",
		};
	});
};
