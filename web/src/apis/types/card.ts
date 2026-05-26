import { Schema } from "effect";

export const CardSchema = Schema.Struct({
    id: Schema.Number,
    content: Schema.String,
    created_at: Schema.String,
    updated_at: Schema.String,
});

export const CreateCardRequestSchema = Schema.Struct({
    content: Schema.String,
});

export const UpdateCardRequestSchema = Schema.Struct({
    content: Schema.optional(Schema.String),
});

export type Card = Schema.Schema.Type<typeof CardSchema>;
export type CreateCardRequest = Schema.Schema.Type<typeof CreateCardRequestSchema>;
export type UpdateCardRequest = Schema.Schema.Type<typeof UpdateCardRequestSchema>;
