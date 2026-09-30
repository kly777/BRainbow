//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。
//!
//! 标签的端口方法（带归属）在 `trait_impl.rs`；这里只留无端口语义的内部工具
//! （孤儿标签回收）。

impl super::super::MemRepo {
    /// 删除无任何 mem 关联的孤儿标签。
    ///
    /// 这是垃圾回收、不是用户操作：判据就是"没人引用它了"，与归属无关
    /// （调用点已经证明调用者能动那条链接）。无链接的标签本来就不可见、不可用。
    pub(crate) async fn delete_orphan_tag(&self, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM tag WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = ?2)",
            tag_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }
}
