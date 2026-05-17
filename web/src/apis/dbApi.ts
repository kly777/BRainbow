import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import type { ApiErrorType } from "./types/index.ts";

const TableListSchema = Schema.Array(Schema.String);

export const getTables = (): Effect.Effect<readonly string[], ApiErrorType> =>
    request("/db", TableListSchema, {});

export interface ColumnInfo {
    readonly name: string;
    readonly col_type: string;
}

const ColumnInfoSchema = Schema.Struct({
    name: Schema.String,
    col_type: Schema.String,
});

const RowSchema = Schema.Array(
    Schema.Union(Schema.String, Schema.Number, Schema.Null),
);

const TableDataSchema = Schema.Struct({
    header: Schema.Array(ColumnInfoSchema),
    rows: Schema.Array(RowSchema),
});

export interface TableData {
    readonly header: readonly ColumnInfo[];
    readonly rows: readonly (readonly (string | number | null)[])[];
}

export const getTableData = (
    name: string,
): Effect.Effect<TableData, ApiErrorType> =>
    request(`/db/${name}`, TableDataSchema, {});
