import { Schema } from "effect";

export const TimeWindowSchema = Schema.Struct({
    id: Schema.Number,
    start_time: Schema.String,
    end_time: Schema.String,
    window_type: Schema.String,
    task_id: Schema.Number,
    user_id: Schema.NullOr(Schema.Number),
});

export const CreateTimeWindowRequestSchema = Schema.Struct({
    start_time: Schema.String,
    end_time: Schema.String,
    window_type: Schema.String,
    task_id: Schema.Number,
    user_id: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type TimeWindow = Schema.Schema.Type<typeof TimeWindowSchema>;
export type CreateTimeWindowRequest = Schema.Schema.Type<typeof CreateTimeWindowRequestSchema>;
