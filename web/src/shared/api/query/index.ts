// ── Query 基础设施：列表、详情、mutation ──
//
// 这是前端唯一的服务端状态入口。页面/模块不直接手写 createResource 的
// loading/error 四态，也不自己维护缓存失效。

export * from "./useDetailResource.ts";
export * from "./useListResource.ts";
export * from "./useMutation.ts";
