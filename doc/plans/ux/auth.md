# Auth / User 模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/user/register` | 注册 | 公开 |
| POST | `/api/user/login` | 登录 | 公开 |
| GET | `/api/user` | 当前用户信息 | 需登录 |

## 前端 API

`web/src/auth/api.ts`:

- `loginE(name, password)` → `AuthUser`
- `registerE(name, password)` → `AuthUser`

`web/src/auth/context.tsx`:

- `AuthProvider` — SolidJS context，从 localStorage 持久化登录态
- `getToken()` — 获取 JWT token 用于请求头

## UX 评估

### ✅ 做得好的

1. **登录态持久化** — 存 localStorage，刷新不丢失
2. **401 自动弹窗** — `request.ts` 统一拦截，触发 `auth:required` 事件，`AuthStatus` 弹出登录框
3. **请求自动带 token** — `request.ts` 的 `buildHeaders()` 统一注入 `Authorization`
4. **登录/注册 API 简洁** — 两个参数，返回完整 user + token

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **无登出 API** | 前端 `logout()` 只清 localStorage，后端无 session 可清除，但可以加一个 `POST /api/user/logout` 做审计日志 |
| **注册无校验** | 后端没有用户名唯一性友好提示（SQLite 唯一约束失败返回 500），应返回 409 + 明确错误码 |
| **无密码修改** | 无 `PATCH /api/user/password` 端点 |
| **无用户列表** | 管理员无法查看/管理用户 |
| **角色系统未使用** | `role` 字段存了 `"user"` / `"admin"`，但前端只有 `isAdmin` 判断路由权限，无 UI 区分 |
| **token 无刷新机制** | JWT 过期后只能重新登录，无 refresh token |
