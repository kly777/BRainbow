//! 视频海报帧：起一个**子进程**跑 ffmpeg 取一帧。
//!
//! 与 `image.rs`（同进程解码位图）刻意分开：这里解的是**不可信媒体**，而视频解码器
//! 的 CVE 历史比位图长得多（`doc/ux/file-preview-plan.md` §P3-2 的三条路线评估）。
//! 起子进程不是为了省事，而是为了隔离 —— 别为了"少一个二进制"把 libav* 链进主进程。
//!
//! 三条资源约束（照计划书的取值）：
//! - `-threads 1`、`-ss` 放在 `-i` **之前**（快速 seek，不必解完整段）；
//! - 只解一帧、缩到目标宽、8 秒超时；子进程同样受 systemd 的 `CPUQuota=80%` /
//!   `MemoryMax=1G` 约束，4K HEVC 解一帧可能上百 MB，所以**并发限 1**；
//! - 不可用就永久降级（`available()` 只探一次），不要每个请求都试错。

use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::process::Command;

/// 单次抽帧超时
pub const FRAME_TIMEOUT: Duration = Duration::from_secs(8);

/// 探测 `-version` 的超时（子进程启动失败要快速回报，别拖住第一个请求）
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// 并发上限：子进程比线程重得多，1 个足够（列表是一次 24 张，慢一点无所谓，
/// 把 CPU/内存留给主服务才是对的）
const MAX_CONCURRENCY: usize = 1;

#[derive(Debug)]
pub enum VideoError {
    /// 起不了进程／超时：调用方按 500 处理（环境问题，不是这个文件的问题）
    Spawn(String),
    /// ffmpeg 跑完但没产出可用帧：调用方按 415 处理，前端退回后缀徽章
    NoFrame(String),
}

impl std::fmt::Display for VideoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(e) => write!(f, "抽帧失败: {e}"),
            Self::NoFrame(e) => write!(f, "取不到画面: {e}"),
        }
    }
}

pub fn semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEM.get_or_init(|| tokio::sync::Semaphore::new(MAX_CONCURRENCY))
}

/// ffmpeg 是否可用（进程内缓存一次）。
///
/// 缓存的意义是"不可用时别再试"：没有 ffmpeg 的部署里，每次列表刷新都会对每个
/// 视频卡片打一次注定失败的探测。**只探一次**，不可用就永久降级为徽章。
pub async fn available(ffmpeg: &Path) -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    if let Some(v) = OK.get() {
        return *v;
    }
    let ok = probe(ffmpeg).await;
    // 并发首次探测可能各算一次，结果一致，无所谓
    *OK.get_or_init(|| ok)
}

async fn probe(ffmpeg: &Path) -> bool {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    matches!(
        tokio::time::timeout(PROBE_TIMEOUT, cmd.status()).await,
        Ok(Ok(status)) if status.success()
    )
}

/// 取一帧写成 JPEG 到 `final_path`（临时文件 + rename，与上传同一套原子写法）。
///
/// 取帧位置是先 1 秒（避开片头的黑场/台标），比 1 秒还短的片子回退到 0 秒 ——
/// 否则短片一个帧都取不到。
pub async fn generate_poster(
    ffmpeg: &Path,
    src: &str,
    width: u32,
    final_path: &str,
) -> Result<(), VideoError> {
    let dir = Path::new(final_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    let tmp = format!("{dir}/tmp_{}.tmp", nanoid::nanoid!(8));

    // `-y` 不给交互机会；`-nostdin` 同理（子进程不该碰我们的标准输入）
    let mut args: Vec<String> = vec![
        "-nostdin".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        "1".into(),
        "-i".into(),
        src.into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        format!("scale={width}:-2"),
        "-threads".into(),
        "1".into(),
        "-f".into(),
        "image2".into(),
        "-y".into(),
        tmp.clone(),
    ];

    let first = run(ffmpeg, &args).await;
    if first.is_err() || !Path::new(&tmp).is_file() {
        // 可能只是"短于 1 秒"：从 0 秒再试一次（同一个子进程约束下，代价可控）
        if let Some(seek) = args.iter_mut().skip_while(|a| *a != "-ss").nth(1) {
            *seek = "0".into();
        }
        let second = run(ffmpeg, &args).await;
        if let Err(e) = second {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e);
        }
    }

    if !Path::new(&tmp).is_file() {
        return Err(VideoError::NoFrame("ffmpeg 没有产出画面".into()));
    }

    if let Err(e) = tokio::fs::rename(&tmp, final_path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(VideoError::Spawn(e.to_string()));
    }
    Ok(())
}

/// 跑一次 ffmpeg，返回是否成功（子进程的非零退出是正常结果，不 panic）
async fn run(ffmpeg: &Path, args: &[String]) -> Result<(), VideoError> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    match tokio::time::timeout(FRAME_TIMEOUT, cmd.output()).await {
        Err(_) => Err(VideoError::Spawn(format!(
            "超过 {} 秒未完成",
            FRAME_TIMEOUT.as_secs()
        ))),
        Ok(Err(e)) => Err(VideoError::Spawn(e.to_string())),
        Ok(Ok(out)) if out.status.success() => Ok(()),
        Ok(Ok(out)) => Err(VideoError::NoFrame(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    /// 一个"永远失败"的假 ffmpeg：探测与抽帧都必须走失败分支而不 panic
    fn fake_ffmpeg(
        script: &str,
    ) -> (
        crate::modules::file::test_support::TempDir,
        std::path::PathBuf,
    ) {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = Path::new(&dir.0).join("ffmpeg");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, path)
    }

    #[tokio::test]
    async fn probe_reports_missing_binary_as_unavailable() {
        let path = Path::new("/nonexistent/ffmpeg");
        assert!(!probe(path).await, "起不来进程应当判为不可用，而不是 panic");
    }

    #[tokio::test]
    async fn probe_accepts_a_working_binary() {
        let (_dir, path) = fake_ffmpeg("#!/bin/sh\nexit 0\n");
        assert!(probe(&path).await);
    }

    #[tokio::test]
    async fn poster_generation_reports_no_frame_when_ffmpeg_fails() {
        let (_dir, path) = fake_ffmpeg("#!/bin/sh\necho 'Invalid data found' >&2\nexit 1\n");
        let out_dir = crate::modules::file::test_support::TempDir::new();
        let final_path = format!("{}/x-320.jpg", out_dir.0);

        match generate_poster(&path, "/tmp/whatever.mp4", 320, &final_path).await {
            Err(VideoError::NoFrame(_)) => {}
            other => panic!("应当是取不到画面，实得 {other:?}"),
        }
        assert!(!Path::new(&final_path).exists(), "失败时不该留下产物");
    }

    /// 成功路径：假 ffmpeg 把输出文件写出来（真 ffmpeg 的行为），产物必须原子落地
    #[tokio::test]
    async fn poster_generation_lands_atomically() {
        let (_dir, path) = fake_ffmpeg(
            "#!/bin/sh\nout=''\nwhile [ $# -gt 0 ]; do out=\"$1\"; shift; done\nprintf JPEGDATA > \"$out\"\nexit 0\n",
        );
        let out_dir = crate::modules::file::test_support::TempDir::new();
        let final_path = format!("{}/x-320.jpg", out_dir.0);

        generate_poster(&path, "/tmp/whatever.mp4", 320, &final_path)
            .await
            .unwrap();

        assert_eq!(std::fs::read(&final_path).unwrap(), b"JPEGDATA");
        // 临时文件必须被 rename 走，不留残渣
        let leftovers: Vec<String> = std::fs::read_dir(&out_dir.0)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("tmp_"))
            .collect();
        assert!(leftovers.is_empty(), "残留: {leftovers:?}");
    }

    /// 资源护栏（`-ss` 在 `-i` 之前、只解一帧、单线程、按宽缩放）不许被悄悄改掉：
    /// 它们对应的是 systemd 的 CPUQuota/MemoryMax 与"4K 解一帧上百 MB"的现实
    #[tokio::test]
    async fn poster_command_keeps_the_resource_guards() {
        // 假 ffmpeg 把自己的 argv 写在 `$0.args`（路径由测试控制，不写 /tmp）
        let (_dir, path) = fake_ffmpeg(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$0.args\"\nout=''\nfor a in \"$@\"; do out=\"$a\"; done\nprintf JPEGDATA > \"$out\"\nexit 0\n",
        );
        let out_dir = crate::modules::file::test_support::TempDir::new();
        let final_path = format!("{}/x-320.jpg", out_dir.0);
        generate_poster(&path, "/tmp/in.mp4", 320, &final_path)
            .await
            .unwrap();

        let recorded = std::fs::read_to_string(format!("{}.args", path.display()))
            .expect("假 ffmpeg 应当记录 argv");
        let args: Vec<&str> = recorded.lines().collect();

        let seek = args.iter().position(|a| *a == "-ss").expect("要有 -ss");
        let input = args.iter().position(|a| *a == "-i").expect("要有 -i");
        assert!(seek < input, "-ss 必须在 -i 之前（快速 seek，不解完整段）");
        assert!(
            args.windows(2).any(|w| w == ["-frames:v", "1"]),
            "只解一帧: {args:?}"
        );
        assert!(
            args.windows(2).any(|w| w == ["-threads", "1"]),
            "单线程: {args:?}"
        );
        assert!(
            args.contains(&"scale=320:-2"),
            "缩到目标宽（-2 保偶数高）: {args:?}"
        );
    }
}
