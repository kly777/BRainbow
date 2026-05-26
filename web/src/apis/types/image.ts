import { Schema } from "effect";

export const ImageSchema = Schema.Struct({
    id: Schema.Number,
    url: Schema.String,
    filename: Schema.String,
    original_name: Schema.String,
    content_type: Schema.String,
});

export const ImageWithDateSchema = Schema.Struct({
    id: Schema.Number,
    url: Schema.String,
    filename: Schema.String,
    original_name: Schema.String,
    content_type: Schema.String,
    created_at: Schema.String,
});

export const PaginatedImageSchema = Schema.Struct({
    items: Schema.Array(ImageWithDateSchema),
    total: Schema.Number,
    page: Schema.Number,
    page_size: Schema.Number,
    total_pages: Schema.Number,
});

export const RenameImageRequestSchema = Schema.Struct({
    original_name: Schema.String,
});

export type Image = Schema.Schema.Type<typeof ImageSchema>;
export type ImageWithDate = Schema.Schema.Type<typeof ImageWithDateSchema>;
export type PaginatedImage = Schema.Schema.Type<typeof PaginatedImageSchema>;
export type RenameImageRequest = Schema.Schema.Type<typeof RenameImageRequestSchema>;
