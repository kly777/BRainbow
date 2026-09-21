//! 子命令实现。
//!
//! 迁移是分阶段的：这一阶段只有**只读**命令
//! （check / status / logs / info / health / list-backups），
//! 构建与部署在后续阶段接进来。只读命令全部可以安全地对着生产跑。

pub mod backups;
pub mod check;
pub mod health;
pub mod info;
pub mod ops;
pub mod status;

use crate::error::{Error, Result};
use crate::ui;

/// 逐项检查的记分板。
///
/// 刻意区分"硬失败"与"只告警"：部署链路上有些东西缺了只是降级
/// （本机还没 `build`、远端没装 sqlite3），不该拦住整个流程；
/// 而 SSH 不通、没有免密 sudo 这类问题则会一路撑到部署中途才炸，必须提前拦。
#[derive(Default)]
pub struct Report {
    failures: Vec<String>,
    warnings: Vec<String>,
}

impl Report {
    pub fn pass(&mut self, msg: &str) {
        ui::done(msg);
    }

    /// 只告警，不阻断。
    pub fn warn(&mut self, msg: &str) {
        ui::warn(msg);
        self.warnings.push(msg.to_string());
    }

    /// 硬失败。
    pub fn fail(&mut self, msg: &str) {
        ui::error(msg);
        self.failures.push(msg.to_string());
    }

    /// dry-run 下没真的执行，既不算过也不算不过。
    pub fn skip(&mut self, msg: &str) {
        ui::info(&format!("{msg}（dry-run 未执行）"));
    }

    pub fn has_failures(&self) -> bool {
        !self.failures.is_empty()
    }

    /// 收口：有硬失败就 `Err`（汇总打印），否则打印通过信息与告警计数。
    pub fn finish(self, ok_message: &str) -> Result<()> {
        if !self.failures.is_empty() {
            return Err(Error::Many(self.failures));
        }
        if !self.warnings.is_empty() {
            ui::warn(&format!(
                "通过，但有 {} 处告警（见上）",
                self.warnings.len()
            ));
        }
        ui::done(ok_message);
        Ok(())
    }
}

/// 取错误信息的第一行：记分板里不需要 ssh 打出来的整段诊断。
pub fn brief(err: &Error) -> String {
    err.to_string()
        .lines()
        .next()
        .unwrap_or("未知错误")
        .to_string()
}
