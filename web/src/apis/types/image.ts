export interface Image {
    id: number;
    url: string;
    filename: string;
    original_name: string;
    content_type: string;
}

export interface ImageWithDate {
    id: number;
    url: string;
    filename: string;
    original_name: string;
    content_type: string;
    created_at: string;
}

export interface PaginatedImage {
    items: ImageWithDate[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

export interface RenameImageRequest {
    original_name: string;
}
