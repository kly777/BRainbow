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

/// 调用者：谁、是不是管理员
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Actor {
    /// 调用者的 user_id（admin 也是普通用户之一，只是多了全量权限）
    pub user_id: i32,
    /// 是否管理员（来自 `Claims.role == "admin"`）
    pub is_admin: bool,
}

impl Actor {
    pub const fn new(user_id: i32, is_admin: bool) -> Self {
        Self { user_id, is_admin }
    }

    /// 普通用户身份的 actor（测试与后台任务用）
    pub const fn user(user_id: i32) -> Self {
        Self::new(user_id, false)
    }

    /// 管理员身份的 actor
    pub const fn admin(user_id: i32) -> Self {
        Self::new(user_id, true)
    }

    /// 绑进 SQL 的归属过滤值：admin → `None`（绑成 NULL，条件恒真），其余 → 自己的 id
    pub const fn owner_scope(&self) -> Option<i32> {
        if self.is_admin {
            None
        } else {
            Some(self.user_id)
        }
    }

    /// 能不能读这行（`owner` 是行上的 `user_id`）
    pub fn can_read(&self, owner: Option<i32>) -> bool {
        self.is_admin || owner == Some(self.user_id)
    }

    /// 能不能改/删这行。
    ///
    /// 现在与 [`Actor::can_read`] 同规则，**但刻意留成两个**：将来若加"共享可读不可写"，
    /// 分叉点就该在这里，而不是散回各模块的 if 里。
    pub fn can_write(&self, owner: Option<i32>) -> bool {
        self.is_admin || owner == Some(self.user_id)
    }
}

impl From<&Claims> for Actor {
    fn from(claims: &Claims) -> Self {
        Self::new(claims.sub, claims.role == "admin")
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
        assert!(Actor::from(&claims(1, "admin")).is_admin);
        assert!(!Actor::from(&claims(2, "user")).is_admin);
        assert_eq!(Actor::from(&claims(2, "user")).user_id, 2);
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
