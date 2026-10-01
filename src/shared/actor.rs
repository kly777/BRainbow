//! 调用者身份与归属判据 —— **授权规则的唯一真相**。
//!
//! 规则（完整矩阵与各模块口径见 `doc/design/authorization.md`）：
//!
//! | | 读 | 改 / 删 |
//! |---|---|---|
//! | admin | 全部 | 全部 |
//! | 普通用户 | 自己创建的 | 只有自己创建的 |
//!
//! 两条附带约定：
//!
//! - **越权按"不存在"处理**（404，不泄露资源是否存在）—— 与 file 模块的既有口径一致；
//! - 老数据（`user_id IS NULL`）在迁移 v20 已认领给 admin，**不再有"无主共享"这一档**；
//!   仍留 NULL 分支的模块是过渡状态，逐个模块清掉（见上面的文档）。
//!
//! SQL 侧只有一种写法：把 [`Actor::owner_scope`] 绑到参数，条件写成
//! `(?1 IS NULL OR <归属列> = ?1)` —— admin 传 NULL 即不过滤，普通用户传自己的 id。
//! 一条 SQL 同时服务两档角色，不用为 admin 另写一条（也就不会漏同步）。
//!
//! 各层都传 `Actor`（handler 从 `Claims` 转，service/query/repository 透传），
//! 不让任何一层自己去拼 `user_id`：**判据只有这一处**。

use crate::shared::claims::Claims;

/// 调用者：谁、是不是管理员。
///
/// **创建即固定，生产路径只有一个构造口**（这是刻意的）：
/// - 字段私有 + 只读访问器 —— 拿到 `&Actor` 之后改不动，`actor.is_admin = true` 这种写法根本不存在；
/// - 生产代码里唯一的构造点是 `From<&Claims>`（认证边界），`Actor::user/admin` 只在 `#[cfg(test)]`
///   下存在 —— 于是"凭空造一个管理员"在生产编译单元里过不了编译，提权只能发生在认证层，
///   而且写出来就看得见（一处映射）。
///
/// 将来若需要"系统身份"（后台任务要动数据），**加一个具名构造器**（如 `Actor::system()`）并把
/// 它的权限与审计含义写清楚，别把 `new` 放开。
///
/// 保持 `Copy`：它现在是个不可变的值，复制没有安全含义，而传参/进 `tokio::spawn` 都省事。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Actor {
    user_id: i32,
    is_admin: bool,
}

impl Actor {
    /// 普通用户身份的 actor（**只在测试里可用**：生产路径走 `From<&Claims>`）
    #[cfg(test)]
    pub const fn user(user_id: i32) -> Self {
        Self {
            user_id,
            is_admin: false,
        }
    }

    /// 管理员身份的 actor（**只在测试里可用**：生产路径走 `From<&Claims>`）
    #[cfg(test)]
    pub const fn admin(user_id: i32) -> Self {
        Self {
            user_id,
            is_admin: true,
        }
    }

    /// 调用者的 user_id（admin 也是普通用户之一，只是多了全量权限）
    pub const fn user_id(&self) -> i32 {
        self.user_id
    }

    /// 是否管理员（来自 `Claims.role == "admin"`）
    pub const fn is_admin(&self) -> bool {
        self.is_admin
    }

    /// 绑进 SQL 的归属过滤值：admin → `None`（绑成 NULL，条件恒真），其余 → 自己的 id
    pub const fn owner_scope(&self) -> Option<i32> {
        if self.is_admin {
            None
        } else {
            Some(self.user_id)
        }
    }

    /// 能不能读这行（`owner` 是行上的 `user_id`）。
    ///
    /// 行级判据按 **i64** 收归属：SQLite 的整数就是 i64，而各表族在 Rust 侧的类型不统一
    /// （`file.user_id` 是 `Option<i64>`，不少表是 `Option<i32>`）。统一按 i64 收，
    /// i32 那侧在调用点 `map(i64::from)` —— 省得为两种宽度各写一套判据。
    pub fn can_read(&self, owner: Option<i64>) -> bool {
        self.is_admin || owner == Some(i64::from(self.user_id))
    }

    /// 能不能改/删这行。
    ///
    /// 现在与 [`Actor::can_read`] 同规则，**但刻意留成两个**：将来若加"共享可读不可写"，
    /// 分叉点就该在这里，而不是散回各模块的 if 里。
    pub fn can_write(&self, owner: Option<i64>) -> bool {
        self.is_admin || owner == Some(i64::from(self.user_id))
    }
}

impl From<&Claims> for Actor {
    /// **生产代码里唯一的构造点**（认证中间件 / 可选凭据解析各用它一次）。
    fn from(claims: &Claims) -> Self {
        Self {
            user_id: claims.sub,
            is_admin: claims.role == "admin",
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn claims(sub: i32, role: &str) -> Claims {
        Claims {
            sub,
            role: role.to_string(),
            exp: 0,
        }
    }

    #[test]
    fn admin_role_maps_to_admin_actor() {
        assert!(Actor::from(&claims(1, "admin")).is_admin());
        assert!(!Actor::from(&claims(2, "user")).is_admin());
        assert_eq!(Actor::from(&claims(2, "user")).user_id(), 2);
    }

    /// SQL 绑参：admin 用 NULL（不过滤），普通用户用自己的 id
    #[test]
    fn owner_scope_is_none_for_admin_only() {
        assert_eq!(Actor::admin(1).owner_scope(), None);
        assert_eq!(Actor::user(7).owner_scope(), Some(7));
    }

    #[test]
    fn read_and_write_matrix() {
        let admin = Actor::admin(1);
        let owner = Actor::user(7);
        let other = Actor::user(8);

        // 自己的行：谁都能读写
        assert!(owner.can_read(Some(7)) && owner.can_write(Some(7)));
        // 别人的行：普通用户不行
        assert!(!other.can_read(Some(7)) && !other.can_write(Some(7)));
        // admin：全部
        assert!(admin.can_read(Some(7)) && admin.can_write(Some(7)));
        // 无主行（历史残留）：只有 admin
        assert!(admin.can_write(None));
        assert!(!owner.can_write(None) && !owner.can_read(None));
    }
}
