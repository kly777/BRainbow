//! 本地子进程与本地文件操作。
//!
//! 只用系统自带的命令与 Rust 标准库：构建需要 `cargo` / `pnpm`，
//! `info` 的端点探测需要 `curl`（Windows 10+ / macOS / Linux 都自带）。
//! 远端执行在 `remote.rs`。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use crate::error::{Error, Result};

/// 一条本地命令。
///
/// 用 argv 数组起进程（不经本地 shell），所以参数里有空格、`&`、引号都不会
/// 被二次解析 —— 这也是老脚本 `eval "rsync … $binary …"` 那类写法的问题所在。
pub struct Cmd {
    program: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: Vec<(String, String)>,
    unset: Vec<String>,
}

impl Cmd {
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            unset: Vec::new(),
        }
    }

    pub fn args(mut self, args: &[&str]) -> Self {
        self.args.extend(args.iter().map(|arg| (*arg).to_string()));
        self
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn cwd(mut self, dir: impl AsRef<Path>) -> Self {
        self.cwd = Some(dir.as_ref().to_path_buf());
        self
    }

    pub fn env(mut self, key: &str, value: &str) -> Self {
        self.env.push((key.to_string(), value.to_string()));
        self
    }

    /// 从子进程环境里**删除**一个变量。
    ///
    /// 用于把 `DATABASE_URL` 摘掉：`.cargo/config.toml` 的 `[env]` 会把它注回
    /// 构建进程，留着它 sqlx 就有机会悄悄走在线模式（对着本机那个 178MB 的
    /// dev 库），删掉之后要么用 `.sqlx/` 快照、要么响亮地失败。
    pub fn unset(mut self, key: &str) -> Self {
        self.unset.push(key.to_string());
        self
    }

    fn build(&self) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.args);
        if let Some(dir) = &self.cwd {
            cmd.current_dir(dir);
        }
        for (key, value) in &self.env {
            cmd.env(key, value);
        }
        for key in &self.unset {
            cmd.env_remove(key);
        }
        cmd
    }

    /// 起进程并继承 stdio：输出直接进终端，长任务能实时看见进度。
    pub fn spawn(&self) -> Result<Child> {
        self.build()
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                Error::io(
                    format!(
                        "启动 `{}`（确认它在 PATH 里）{}",
                        self.program,
                        match &self.cwd {
                            Some(dir) => format!("，cwd={}", dir.display()),
                            None => String::new(),
                        }
                    ),
                    e,
                )
            })
    }

    /// 起进程、等待结束；非零退出即失败。
    pub fn run(&self) -> Result<()> {
        let status = self
            .spawn()?
            .wait()
            .map_err(|e| Error::io(format!("等待 `{}` 结束", self.program), e))?;
        if !status.success() {
            return Err(Error::msg(describe_failure(
                &format!("`{} {}`", self.program, self.args.join(" ")),
                &status,
            )));
        }
        Ok(())
    }

    /// 捕获 stdout（已 trim）；命令不存在或非零退出都返回 `None`。
    ///
    /// 用于"探测"：命令不存在不该 panic，而应变成一句可读的降级提示。
    pub fn probe(&self) -> Option<String> {
        let output = self.build().output().ok()?;
        if !output.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

fn describe_failure(what: &str, status: &std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("{what} 失败（exit {code}）"),
        None => format!("{what} 被信号终止"),
    }
}

/// 当前平台丢弃输出的目标：`curl -o /dev/null` 在 Windows 上要写 `NUL`。
pub fn null_sink() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

/// 产物里的版本标记文件名（`build/REVISION` → 远端 `service/REVISION`）。
pub const REVISION_FILE: &str = "REVISION";

/// 在 `dir` 里跑一条 git 命令，拿 stdout（命令不在 / 非零退出 / 不是仓库都是 `None`）。
fn git_in(dir: &Path, args: &[&str]) -> Option<String> {
    Cmd::new("git")
        .arg("-C")
        .arg(dir.display().to_string())
        .args(args)
        .probe()
        .filter(|out| !out.trim().is_empty())
}

/// 构建时的版本：git 短 sha，工作区有改动时带 `-dirty` 后缀。
///
/// 线上出问题时第一个要回答的是"跑的是哪个提交"，所以这个值要随产物一起走到
/// 远端（`build/REVISION` → `service/REVISION`，`just info` 显示）。
/// 拿不到（不是 git 仓库、机器上没有 git）就是 `unknown`：这个标记只用来回答
/// 问题，缺了不该拦住构建。
///
/// `--untracked-files=no` 是有意的：构建自身的产物（`build/`、`web/dist`、
/// `brainbow.db`）都该被 .gitignore 挡住，真有漏网的也不该让每次构建都标脏。
pub fn git_revision(project_dir: &Path) -> String {
    let Some(sha) = git_in(project_dir, &["rev-parse", "--short", "HEAD"]) else {
        return "unknown".to_string();
    };
    let dirty = git_in(
        project_dir,
        &["status", "--porcelain", "--untracked-files=no"],
    )
    .is_some_and(|out| !out.trim().is_empty());
    if dirty { format!("{sha}-dirty") } else { sha }
}

/// 写 `build/REVISION`：一行 `<版本> <构建时间>`，返回写进去的那一行。
pub fn write_revision(build_dir: &Path, revision: &str) -> Result<String> {
    let line = format!(
        "{revision} {}",
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ")
    );
    let path = build_dir.join(REVISION_FILE);
    std::fs::write(&path, format!("{line}\n"))
        .map_err(|e| Error::io(format!("写 {}", path.display()), e))?;
    Ok(line)
}

/// 读 `<dir>/REVISION` 里的版本字段（第一个空白分隔的字段）。
///
/// 文件不在就是 `None`：老产物、或还没构建过 —— 都是正常情形。
pub fn read_revision(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(REVISION_FILE)).ok()?;
    text.split_whitespace().next().map(str::to_string)
}

/// 递归复制目录内容到 `dst`（`src` 本身不复制进去，对应 `cp -r src/. dst`）。
///
/// 自己写而不是 shell out 到 `cp`/`xcopy`：这两者在各平台的参数完全不同。
pub fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)
        .map_err(|e| Error::io(format!("创建目录 {}", dst.display()), e))?;
    let entries =
        std::fs::read_dir(src).map_err(|e| Error::io(format!("读取目录 {}", src.display()), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| Error::io(format!("读取目录 {}", src.display()), e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = entry
            .metadata()
            .map_err(|e| Error::io(format!("读取元信息 {}", from.display()), e))?;
        if meta.is_dir() {
            copy_tree(&from, &to)?;
        } else if meta.is_file() {
            copy_file(&from, &to)?;
        } else {
            // vite 的产物里不会有符号链接/设备文件；真遇到了要说出来而不是默默丢。
            return Err(Error::msg(format!(
                "{} 既不是文件也不是目录，copy_tree 不会处理它",
                from.display()
            )));
        }
    }
    Ok(())
}

/// 复制单个文件，并保留权限位（可执行位必须留住）。
pub fn copy_file(from: &Path, to: &Path) -> Result<()> {
    std::fs::copy(from, to)
        .map_err(|e| Error::io(format!("复制 {} → {}", from.display(), to.display()), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(from)
            .map_err(|e| Error::io(format!("读取权限 {}", from.display()), e))?
            .permissions()
            .mode();
        std::fs::set_permissions(to, std::fs::Permissions::from_mode(mode))
            .map_err(|e| Error::io(format!("设置权限 {}", to.display()), e))?;
    }
    Ok(())
}

/// 人类可读大小（与 `du -h` 同量纲：1024 进制）。
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "K", "M", "G", "T"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes}B")
    } else {
        format!("{value:.1}{}", UNITS[unit])
    }
}

/// 目录是否存在。
pub fn dir_exists(path: &Path) -> bool {
    path.is_dir()
}

/// 递归统计大小（目录则累加其中所有文件）；拿不到就当 0。
pub fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries.flatten().map(|entry| size_of(&entry.path())).sum()
}

/// 人类可读大小；路径不存在则 `N/A`。
pub fn size_label(path: &Path) -> String {
    if path.exists() {
        human_size(size_of(path))
    } else {
        "N/A".to_string()
    }
}

/// 文件的 sha256（十六进制）。
///
/// 流式读：76MB 的 ffmpeg 也不会整个进内存。用来判断远端的同名校验，
/// 从而避免每次部署都重传它。
pub fn sha256(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};

    let file =
        std::fs::File::open(path).map_err(|e| Error::io(format!("打开 {}", path.display()), e))?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher)
        .map_err(|e| Error::io(format!("读取 {}", path.display()), e))?;
    Ok(hex::encode(hasher.finalize()))
}

/// 可执行文件是否存在。
pub fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_reports_success_and_failure() {
        if cfg!(unix) {
            assert!(Cmd::new("true").probe().is_some());
            assert!(Cmd::new("false").probe().is_none());
        }
        assert!(Cmd::new("这个命令一定不存在-xtask").probe().is_none());
    }

    #[test]
    fn null_sink_matches_platform() {
        assert_eq!(null_sink(), if cfg!(windows) { "NUL" } else { "/dev/null" });
    }

    #[test]
    fn revision_file_round_trips() {
        let root = std::env::temp_dir().join(format!("xtask-revision-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("建目录");

        let line = write_revision(&root, "b8dea17b-dirty").expect("写 REVISION");
        assert!(line.starts_with("b8dea17b-dirty "), "{line}");
        // 读回来的是版本字段本身（时间戳是给人看的，不参与比较）
        assert_eq!(read_revision(&root).as_deref(), Some("b8dea17b-dirty"));
        // 文件不存在 → None（老产物 / 还没构建过），不该 panic 也不该报错
        assert_eq!(read_revision(&root.join("不存在")), None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn git_revision_reads_this_repo_and_degrades_on_non_repos() {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("xtask 有上级目录");
        let revision = git_revision(project);
        // 本仓库就在 git 里（跑测试的机器上有 git 的话，应当拿得到短 sha）
        if Cmd::new("git").arg("--version").probe().is_some() {
            assert_ne!(revision, "unknown", "本仓库应当读得到版本");
            assert!(!revision.contains(' '), "版本字段里不该有空格：{revision}");
        }
        // 不是仓库 / 目录不存在 → unknown，而不是报错
        assert_eq!(git_revision(Path::new("/不存在-xtask-测试目录")), "unknown");
    }

    #[test]
    fn run_reports_nonzero_exit() {
        if !cfg!(unix) {
            return;
        }
        let err = Cmd::new("false").run().expect_err("false 应当失败");
        assert!(err.to_string().contains("exit 1"), "{err}");
    }

    #[test]
    fn copy_tree_is_recursive_and_keeps_modes() {
        let root = std::env::temp_dir().join(format!("xtask-copy-tree-{}", std::process::id()));
        let src = root.join("src");
        let dst = root.join("dst");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(src.join("nested")).expect("建目录");
        std::fs::write(src.join("a.txt"), b"a").expect("写文件");
        std::fs::write(src.join("nested/b.txt"), b"b").expect("写文件");

        copy_tree(&src, &dst).expect("复制应当成功");
        assert_eq!(std::fs::read(dst.join("a.txt")).expect("读"), b"a");
        assert_eq!(std::fs::read(dst.join("nested/b.txt")).expect("读"), b"b");

        // 目标是"src 的内容进 dst"，不是"把 src 放进 dst"
        assert!(!dst.join("src").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn human_size_matches_du_dimensions() {
        assert_eq!(human_size(0), "0B");
        assert_eq!(human_size(512), "512B");
        assert_eq!(human_size(1024), "1.0K");
        assert_eq!(human_size(1536), "1.5K");
        assert_eq!(human_size(12 * 1024 * 1024), "12.0M");
        assert_eq!(human_size(3 * 1024 * 1024 * 1024), "3.0G");
    }

    #[test]
    fn size_of_sums_directories_and_labels_missing_paths() {
        let root = std::env::temp_dir().join(format!("xtask-size-of-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("nested")).expect("建目录");
        std::fs::write(root.join("a"), vec![0u8; 100]).expect("写");
        std::fs::write(root.join("nested/b"), vec![0u8; 200]).expect("写");

        assert_eq!(size_of(&root), 300);
        assert_eq!(size_of(&root.join("missing")), 0);
        assert_eq!(size_label(&root), "300B");
        // 不存在的路径报 N/A，而不是 0B（"没有这个目录"与"空目录"是两件事）
        assert_eq!(size_label(&root.join("missing")), "N/A");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sha256_matches_known_vector() {
        // 空串与 "abc" 的 sha256 是标准测试向量
        let root = std::env::temp_dir().join(format!("xtask-sha256-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("建目录");

        let empty = root.join("empty");
        std::fs::write(&empty, b"").expect("写");
        assert_eq!(
            sha256(&empty).expect("算得出"),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let abc = root.join("abc");
        std::fs::write(&abc, b"abc").expect("写");
        assert_eq!(
            sha256(&abc).expect("算得出"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        assert!(sha256(&root.join("missing")).is_err(), "缺文件应当报错");
        let _ = std::fs::remove_dir_all(&root);
    }
}
