//! 记忆模块配置：FSRS 参数 + 调度器配置的持久化。
//!
//! 配置文件路径：`mem_config.json`（工作目录）

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const CONFIG_PATH: &str = "mem_config.json";

/// 持久化配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemConfig {
    /// FSRS 参数（19 个浮点数），空 = 用默认值
    #[serde(default)]
    pub fsrs_params: Vec<f32>,

    /// 学习步进（秒）
    #[serde(default = "default_learning_steps")]
    pub learning_steps: Vec<i64>,

    /// 重学步进（秒）
    #[serde(default = "default_relearn_steps")]
    pub relearn_steps: Vec<i64>,

    /// 毕业最小间隔（秒）
    #[serde(default = "default_graduating_interval")]
    pub graduating_interval_secs: i64,

    /// 期望回忆率
    #[serde(default = "default_desired_retention")]
    pub desired_retention: f64,
}

fn default_learning_steps() -> Vec<i64> {
    vec![60, 600]
}
fn default_relearn_steps() -> Vec<i64> {
    vec![600]
}
fn default_graduating_interval() -> i64 {
    7200
}
fn default_desired_retention() -> f64 {
    0.9
}

impl Default for MemConfig {
    fn default() -> Self {
        Self {
            fsrs_params: Vec::new(),
            learning_steps: default_learning_steps(),
            relearn_steps: default_relearn_steps(),
            graduating_interval_secs: default_graduating_interval(),
            desired_retention: default_desired_retention(),
        }
    }
}

impl MemConfig {
    /// 从默认路径加载；不存在则返回默认值
    pub fn load() -> Self {
        Self::load_from(Path::new(CONFIG_PATH))
    }

    /// 从指定路径加载；不存在则返回默认值
    pub fn load_from(path: &Path) -> Self {
        if path.exists() {
            match fs::read_to_string(path) {
                Ok(content) => match serde_json::from_str::<MemConfig>(&content) {
                    Ok(cfg) => {
                        tracing::info!("已加载记忆配置，FSRS 参数数: {}", cfg.fsrs_params.len());
                        return cfg;
                    }
                    Err(e) => {
                        tracing::warn!("解析 {} 失败 ({}), 使用默认配置", path.display(), e);
                    }
                },
                Err(e) => {
                    tracing::warn!("读取 {} 失败 ({}), 使用默认配置", path.display(), e);
                }
            }
        } else {
            tracing::info!("{} 不存在，创建默认配置文件", path.display());
            let cfg = MemConfig::default();
            if let Err(e) = cfg.save_to(path) {
                tracing::warn!("创建 {} 失败: {}", path.display(), e);
            }
            return cfg;
        }
        MemConfig::default()
    }

    /// 保存到默认路径
    pub fn save(&self) -> Result<(), String> {
        self.save_to(Path::new(CONFIG_PATH))
    }

    /// 保存到指定路径
    fn save_to(&self, path: &Path) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, &content).map_err(|e| e.to_string())?;
        tracing::info!("已保存记忆配置到 {}", path.display());
        Ok(())
    }

    /// 更新 FSRS 参数并保存
    pub fn update_fsrs_params(&mut self, params: Vec<f32>) -> Result<(), String> {
        self.fsrs_params = params;
        self.save()
    }
}

/// 加载配置并初始化全局 FSRS 参数
///
/// `config_path`：配置文件的路径，默认 `mem_config.json`。
pub fn load_and_init_mem_config(config_path: Option<&Path>) -> MemConfig {
    let path = config_path.unwrap_or(Path::new(CONFIG_PATH));
    let cfg = MemConfig::load_from(path);
    crate::modules::mem::fsrs::init_global_params(cfg.fsrs_params.clone());
    cfg
}
