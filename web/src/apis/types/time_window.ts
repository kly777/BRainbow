export interface TimeWindow {
    id: number;
    start_time: string;
    end_time: string;
    window_type: string;
    task_id: number;
    user_id: number | null;
}

export interface CreateTimeWindowRequest {
    start_time: string;
    end_time: string;
    window_type: string;
    task_id: number;
    user_id?: number | null;
}
