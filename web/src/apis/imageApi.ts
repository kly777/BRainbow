import { request } from "./request.ts";
import { getToken } from "../auth/context.tsx";
import {
    HttpError,
    NetworkError,
    type Image,
    type PaginatedImage,
    type RenameImageRequest,
} from "./types/index.ts";

// ── 内部辅助 ──

async function extractImageError(response: Response): Promise<{
    code: string;
    message: string;
    details?: unknown;
}> {
    try {
        const json = await response.json();
        if (
            json && typeof json.code === "string" &&
            typeof json.message === "string"
        ) {
            return { code: json.code, message: json.message, details: json.details };
        }
        if (json && typeof json.error === "string") {
            return { code: `HTTP_${response.status}`, message: json.error };
        }
        return { code: `HTTP_${response.status}`, message: JSON.stringify(json) };
    } catch {
        return { code: `HTTP_${response.status}`, message: `HTTP ${response.status}` };
    }
}

// ── 图片 API ──

/** 上传图片（multipart/form-data） */
export const uploadImage = async (file: File): Promise<Image> => {
    const formData = new FormData();
    formData.append("file", file);

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
        response = await fetch("/api/images/upload", {
            method: "POST",
            headers,
            body: formData,
        });
    } catch (cause: unknown) {
        throw new NetworkError({ cause });
    }

    if (!response.ok) {
        let err: { code: string; message: string; details?: unknown };
        try {
            err = await extractImageError(response);
        } catch (cause: unknown) {
            throw new NetworkError({ cause });
        }
        throw new HttpError({
            status: response.status,
            code: err.code,
            message: err.message,
            details: err.details,
        });
    }

    let json: unknown;
    try {
        json = await response.json();
    } catch (cause: unknown) {
        throw new NetworkError({ cause });
    }

    return json as Image;
};

/** 获取所有图片 */
export const listImagesE = (): Promise<PaginatedImage> =>
    request("/images", {});

/** 重命名图片 */
export const renameImageE = (id: number, req: RenameImageRequest): Promise<Image> =>
    request(`/images/${id}`, {
        method: "PATCH",
        body: JSON.stringify(req),
    });

/** 删除图片 */
export const deleteImageE = (id: number): Promise<void> =>
    request(`/images/${id}`, { method: "DELETE" });
