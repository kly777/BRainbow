//! `deploy` —— 全量部署。
//!
//! 步骤与 deploy.sh 的 `cmd_deploy`（362-496）一一对应，只把**传文件挪到了
//! 停服之前**（见下面的第 3 点），其余顺序不变：停服 → 备份 → 清理 → 就位
//! → 权限 → 装 unit → 起服 → 等就绪 →（只读自检 / 优化 / 同步 Caddy，
//! 失败只告警）。
//!
//! 四处刻意的改动：
//! 1. **传输不用 rsync**：进程内打 tar.gz 灌进 ssh 的 stdin（本机不需要
//!    rsync/scp/sftp，Windows 上也就没有"没有 rsync"这回事）。`ffmpeg` 有
//!    76MB，老实现靠 rsync 的 mtime+size 跳过它，所以这里显式比 sha256 ——
//!    一致就不带，不然每次部署白传 76MB。
//! 2. **先传暂存目录再就位**，而不是原地覆盖。传输或解包中断不会留下半个
//!    二进制；`dist` 换目录用 `.old` 过渡，中间那一瞬旧目录还在手边。
//! 3. **上传发生在停服之前**：它跟服务在不在没关系（传的是暂存目录），而它
//!    是停机时间里的大头（4MB 的 dist，带 ffmpeg 时还有 76MB）。于是停机
//!    窗口里只剩"与数据库有关的那几步"和"就位 + 起服"。
//! 4. **恢复是显式的 `Result` 处理**，不是 bash 的 `ERR` trap。老写法的
//!    trap 刻意避开"显式 exit"，于是"哪些失败会触发回滚"很难讲清楚；这里
//!    只有关键区（上传 → 停服 → 就绪）会触发恢复，服务就绪之后的事情一律
//!    只告警。

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::caddy;
use crate::config::Config;
use crate::db::{Db, utc_stamp};
use crate::error::{Error, Result};
use crate::local;
use crate::remote::{Remote, glob_in, path_of, sh_quote};
use crate::render;
use crate::rollback;
use crate::stamp;
use crate::ui;

/// 把暂存目录里的 `dist/` 换到运行位置，并修好权限。
///
/// `dist` 用 `.old` 过渡：中间那一瞬目录不存在，但旧目录还在手边。
pub fn activate_dist(cfg: &Config, remote: &Remote, staging: &str) -> Result<()> {
    let live = path_of(&cfg.service_dir, "dist");
    let old = path_of(&cfg.service_dir, "dist.old");
    remote.ok(&format!(
        "rm -rf {o} && mv {l} {o}",
        o = sh_quote(&old),
        l = sh_quote(&live)
    ))?;
    remote.ok(&format!(
        "mv {} {}",
        sh_quote(&path_of(staging, "dist")),
        sh_quote(&live)
    ))?;
    remote.ok(&format!("rm -rf {}", sh_quote(&old)))?;

    // dist 由 Caddy 以另一个用户（caddy）读取：目录 755 / 文件 644。
    // 就在换目录这一步设好 —— 只有这里知道"刚换上去的是哪个目录"。
    remote.ok(&chmod_dist_command(&cfg.service_dir))?;
    Ok(())
}

/// `deploy-web`：只换前端 —— 不停服、不动 unit、不备份数据库。
///
/// 前端是静态文件，Caddy 直接读盘，所以换完不需要 reload；最后与本地比对一次
/// sha256，确认真的换成了（老 Makefile 的 deploy-web 用 md5 做同一件事）。
pub fn run_deploy_web(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!(
        "仅部署前端 {} → {}",
        cfg.app_name, cfg.remote_host
    ));

    let dist = cfg.build_dir().join("dist");
    if !dist.join("index.html").is_file() {
        return Err(Error::msg(format!(
            "{} 不存在：先跑 `just build`",
            dist.join("index.html").display()
        )));
    }

    let staging = format!("{}/web_{}", cfg.remote_tmp_dir(), utc_stamp());
    remote.ok(&format!("mkdir -p {}", sh_quote(&cfg.remote_tmp_dir())))?;
    sweep_stale_staging(cfg, remote);
    remote.ok(&format!(
        "rm -rf {s} && mkdir -p {s}",
        s = sh_quote(&staging)
    ))?;
    remote.send_tar(
        &format!("tar -xzf - -C {}", sh_quote(&staging)),
        "前端产物",
        |archive| {
            archive
                .append_dir_all("dist", &dist)
                .map_err(|e| Error::io("打包 dist", e))
        },
    )?;

    if !remote.is_dry_run() {
        let staged_index = path_of(&staging, "dist/index.html");
        if !remote.condition(&format!("[ -f {} ]", sh_quote(&staged_index))) {
            return Err(Error::msg(
                "上传后暂存目录里没有 dist/index.html（传输被截断？已中止，运行目录未动）",
            ));
        }
    }
    activate_dist(cfg, remote, &staging)?;
    let _ = remote.ok(&format!("rm -rf {}", sh_quote(&staging)));

    if !remote.is_dry_run() {
        let local = local::sha256(&dist.join("index.html"))?;
        let remote_hash = remote
            .capture(&format!(
                "sha256sum {}",
                sh_quote(&path_of(&cfg.service_dir, "dist/index.html"))
            ))?
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        if remote_hash != local {
            return Err(Error::msg(format!(
                "远端 index.html 与本地不一致（远端 {remote_hash} / 本地 {local}）—— 同步疑似失败"
            )));
        }
        ui::done("校验通过：远端与本地 index.html 一致");
    }
    ui::done("前端部署完成（未停服）");
    Ok(())
}

/// 产物比源码旧时提示一句。
///
/// 老 `make deploy` 是「build + deploy」一条命令，`just` 这边拆成了两个
/// （`just build` / `just deploy`）—— 于是"改了代码忘了重新构建就部署"
/// 变成一个安静的陷阱，这里把它说出来。
fn warn_if_stale(cfg: &Config, binary: &Path) {
    let Ok(built_at) = std::fs::metadata(binary).and_then(|meta| meta.modified()) else {
        return;
    };
    let newest = [
        newest_source(&cfg.project_dir.join("src")),
        newest_source(&cfg.web_dir().join("src")),
    ]
    .into_iter()
    .flatten()
    .max_by_key(|(at, _)| *at);

    if let Some((source_at, path)) = newest
        && source_at > built_at
    {
        ui::warn(&format!(
            "build/ 可能已过期（{} 比产物新）：先跑 `just build`",
            path.strip_prefix(&cfg.project_dir)
                .unwrap_or(&path)
                .display()
        ));
    }
}

/// 递归找出目录里 mtime 最新的文件。
fn newest_source(dir: &Path) -> Option<(std::time::SystemTime, PathBuf)> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        let candidate = if meta.is_dir() {
            newest_source(&path)
        } else {
            meta.modified().ok().map(|at| (at, path))
        };
        if let Some(candidate) = candidate
            && newest.as_ref().is_none_or(|(at, _)| candidate.0 > *at)
        {
            newest = Some(candidate);
        }
    }
    newest
}

/// 等 `/api/health` 就绪（30 次 × 1 秒，与老脚本一致）。
///
/// dry-run 下命令没执行，直接返回（不能干等 30 秒，也不该判成失败）。
pub fn wait_for_ready(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::info("等待服务就绪…");
    for attempt in 1..=READY_ATTEMPTS {
        match probe_health(cfg, remote)? {
            None => {
                ui::info("等待服务就绪（dry-run 未执行）");
                return Ok(());
            }
            Some(true) => {
                ui::done(&format!("服务就绪（第 {attempt} 次探测）"));
                return Ok(());
            }
            Some(false) => {
                print!(".");
                let _ = std::io::Write::flush(&mut std::io::stdout());
                std::thread::sleep(READY_INTERVAL);
            }
        }
    }
    println!();
    Err(Error::msg(format!(
        "服务在 {READY_ATTEMPTS}s 内没有就绪，看 `just logs`"
    )))
}

/// 探一次 `/api/health`：`Some(true)` 表示 200，`None` 表示 dry-run 没执行。
fn probe_health(cfg: &Config, remote: &Remote) -> Result<Option<bool>> {
    let url = format!("http://localhost:{}/api/health", cfg.service_port);
    let cmd = format!(
        "curl -s -o /dev/null -w '%{{http_code}}' --connect-timeout 2 --max-time 5 {} 2>/dev/null || echo 000",
        sh_quote(&url)
    );
    Ok(remote.capture_if_run(&cmd)?.map(|code| code == "200"))
}

/// 去掉 ANSI（CSI）转义序列，形如 `\u{1b}[2m`。
///
/// 自检输出是带颜色的（tracing 在有/没有 TTY 时都可能吐颜色码），
/// 不剥掉的话那个 `\u{1b}[2m` 里的 `[` 会被当成小结行的方括号。
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        // 只处理 CSI（`ESC [ 参数 终止字母`）。其它 ESC 序列很少见，
        // 那就只丢掉 ESC 本身 —— 用 peek 判断，避免把紧随其后的正常字符一起吞掉。
        if chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

/// 自检输出里的分段小结行，形如 `[1/5] 数据库 schema: …`。
///
/// 按**形状**判断（中括号里是 `数字/数字`），不写死段数：段数会随版本变
/// （加"缩略图缓存"那段就从 /4 变成了 /5）。
fn is_summary_line(line: &str) -> bool {
    let line = strip_ansi(line);
    let line = line.as_str();
    let Some(open) = line.find('[') else {
        return false;
    };
    let rest = &line[open + 1..];
    let Some(close) = rest.find(']') else {
        return false;
    };
    let Some((left, right)) = rest[..close].split_once('/') else {
        return false;
    };
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    digits(left) && digits(right)
}

/// 一次部署要上传的产物。
struct Payload<'a> {
    /// 本地 release 二进制 → 归档里的 `brainbow`。
    binary: PathBuf,
    /// 前端产物目录 → 归档里的 `dist/`。
    dist: PathBuf,
    /// `vendor/ffmpeg/bin` 下的可执行文件 → 归档里的 `bin/<name>`。
    /// 借用而不是拿走：`bin/` 就位那一步还要用同一份清单。
    bin: &'a [(PathBuf, String)],
    /// 是否带上 `bin/`（与远端一致时省掉这 76MB）。
    ship_bin: bool,
}

/// 已上传到远端暂存目录、等着就位的产物。
///
/// 上传与就位被拆开，是因为中间夹着"停服"：上传不需要停服（传的是暂存目录），
/// 就位必须在停服之后。`Staged` 就是把这两步之间的状态带过去。
struct Staged {
    /// 远端暂存目录（`tmp/deploy_<ts>`）。
    dir: String,
    /// 随产物走的 `bin/` 文件 —— 就位那一步要用同一份清单。
    bin: Vec<(PathBuf, String)>,
}

/// 把产物写进归档。
///
/// 单独拎出来是为了可测：**归档里的条目名是部署契约的一部分**（远端就按
/// `brainbow` / `dist/…` / `bin/…` 这三个位置就位），而整条上传路径要连 ssh，
/// 不适合在单测里跑。
fn write_payload(
    archive: &mut tar::Builder<impl std::io::Write>,
    payload: &Payload<'_>,
) -> Result<()> {
    archive
        .append_path_with_name(&payload.binary, "brainbow")
        .map_err(|e| Error::io("打包 brainbow", e))?;
    archive
        .append_dir_all("dist", &payload.dist)
        .map_err(|e| Error::io("打包 dist", e))?;
    if payload.ship_bin {
        for (path, name) in payload.bin {
            archive
                .append_path_with_name(path, format!("bin/{name}"))
                .map_err(|e| Error::io(format!("打包 {}", path.display()), e))?;
        }
    }
    Ok(())
}

/// `service/brainbow` 的可执行位。
fn chmod_binary_command(service_dir: &str) -> String {
    format!("chmod 755 {}", sh_quote(&path_of(service_dir, "brainbow")))
}

/// `dist/` 的权限扫描（目录 755 / 文件 644）。
fn chmod_dist_command(service_dir: &str) -> String {
    format!(
        "find {d} -type d -exec chmod 755 {{}} + ; find {d} -type f -exec chmod 644 {{}} +",
        d = sh_quote(&path_of(service_dir, "dist"))
    )
}

/// `bin/` 下可执行文件的权限。
///
/// 注意 `glob_in` 已经带了 `*`，不要再往后面拼 `/*` —— 拼成 `'dir'/*/*` 时
/// 模式什么都匹配不到，bash 会把字面量传给 chmod，于是 `chmod: cannot access`
/// 让整步失败（真实踩过一次）。
fn chmod_bin_command(service_dir: &str) -> String {
    format!("chmod 755 {}", glob_in(&path_of(service_dir, "bin"), "*"))
}

/// 就绪探测次数与间隔（与老脚本一致：30 次 × 1 秒）。
const READY_ATTEMPTS: u32 = 30;
const READY_INTERVAL: Duration = Duration::from_secs(1);

/// 自动恢复要不要连数据库一起回滚：**schema 版本变了就要**。
///
/// 单独拎出来是因为这条判断决定了"用户数据会不会被覆盖"，值得有断言盯着：
/// - 前后都是同版本 → 只回代码（不动用户数据）；
/// - 版本变了（这次部署跑过迁移）→ 必须连库一起回，否则旧二进制启动即失败；
/// - 读不到（`None`：远端没有 sqlite3）→ 按"变了"处理，宁多回一份库。
fn needs_db_restore(schema_before: Option<i64>, schema_now: Option<i64>) -> bool {
    match schema_before {
        Some(before) => schema_now != Some(before),
        None => true,
    }
}

/// 清掉 `tmp/` 里超过一天的暂存目录（`deploy_*` / `web_*` / `rollback_*`）。
///
/// 正常路径会自己收尾，但进程被 Ctrl-C 掉、或 ssh 断掉的时候不会 —— 那些残骸
/// 一份几 MB 到几十 MB，不清就一直在。只认我们自己的前缀，删除只发生在这个
/// 目录里；失败也只警告（`|| true`），打扫不该拦住部署。
fn sweep_stale_staging(cfg: &Config, remote: &Remote) {
    let cmd = format!(
        "find {tmp} -mindepth 1 -maxdepth 1 -mtime +0 \
         \\( -name 'deploy_*' -o -name 'web_*' -o -name 'rollback_*' \\) \
         -exec rm -rf {{}} + 2>/dev/null || true",
        tmp = sh_quote(&cfg.remote_tmp_dir())
    );
    if let Err(e) = remote.ok(&cmd) {
        ui::warn(&format!("清理旧暂存目录失败（不影响部署）：{e}"));
    }
}

pub fn run(cfg: &mut Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("部署 {} → {}", cfg.app_name, cfg.remote_host));

    // ── 本地前置检查 ──
    let binary = cfg.build_dir().join("brainbow");
    let dist = cfg.build_dir().join("dist");
    if !binary.is_file() {
        return Err(Error::msg(format!(
            "{} 不存在：先跑 `just build`",
            binary.display()
        )));
    }
    if !dist.join("index.html").is_file() {
        return Err(Error::msg(format!(
            "{} 不存在：先跑 `just build`",
            dist.join("index.html").display()
        )));
    }

    // 动远端之前先确认这个二进制在那台机器上跑得起来：libc 不匹配的话
    // 服务已经停了、备份已经做了才会发现（真实踩过一次）。
    match crate::compat::compare(remote, &binary)? {
        crate::compat::Verdict::Ok(_) => {}
        crate::compat::Verdict::Broken(detail) => return Err(Error::msg(detail)),
        crate::compat::Verdict::Unknown(detail) => {
            ui::warn(&format!("无法确认 libc 兼容性 —— {detail}"));
        }
    }

    warn_if_stale(cfg, &binary);

    // JWT_SECRET：只有这条路径会生成并写回 .env.prod
    let jwt_secret = cfg.require_jwt_secret(true)?;

    // 模板先在本地渲染好（纯字符串替换 + 占位符残留断言），
    // 失败在部署开始之前就发生。
    let plan = Plan {
        timestamp: utc_stamp(),
        unit: render::systemd_unit(cfg, &jwt_secret)?,
        caddyfile: render::caddyfile(cfg)?,
    };

    Deploy { cfg, remote, plan }.execute()
}

struct Plan {
    /// 本次部署的 UTC 时间戳。数据库备份 `db_deploy_<ts>.db` 与代码备份
    /// `code_<ts>.tar.gz` 共用它 —— 回滚因此能按同一个键配对。
    timestamp: String,
    unit: String,
    caddyfile: String,
}

struct Deploy<'a> {
    cfg: &'a Config,
    remote: &'a Remote,
    plan: Plan,
}

impl Deploy<'_> {
    fn execute(&self) -> Result<()> {
        // 停服前记一次 schema 版本：自动恢复要靠它判断"这次部署动过库没有"。
        // 放在这里（而不是恢复的时候）是因为那一刻新二进制可能已经跑过迁移了。
        let schema_before = self.schema_version();

        // 关键区：停服 → 就绪。这里任何一步失败都要走自动恢复。
        if let Err(err) = self.critical_path() {
            ui::warn("部署中途失败，尝试自动恢复…");
            match self.recover(schema_before) {
                Ok(()) => ui::warn("已自动恢复（详情见上）"),
                Err(recover) => ui::warn(&format!("自动恢复也没成功：{recover}")),
            }
            return Err(err);
        }

        // 服务已经就绪。下面几件事失败只告警 —— 它们报告的是数据层问题或
        // 边缘配置问题，回滚代码解决不了（老脚本的注释也是这个理由）。
        self.self_check();
        self.optimize();
        self.sync_caddy();

        println!();
        ui::done("部署完成");
        Ok(())
    }

    fn critical_path(&self) -> Result<()> {
        // 上传放在停服之前：它跟服务在不在没关系（传的是暂存目录），老顺序却
        // 把它算进了停机窗口 —— 4MB 的 dist 加上可选的 76MB ffmpeg，那才是
        // 停机时间里的大头。于是停服之后只剩"与数据库有关的那几步"和
        // "就位 + 起服"。
        let staged = self.stage_payload()?;
        let result = self.after_staging(&staged);
        if result.is_err() {
            // 失败时把暂存目录带走：产物要么已经就位（那目录已经空了），要么
            // 压根没就位（更没必要留着）。留着只会在 tmp/ 里积攒几十 MB。
            let _ = self.remote.ok(&format!("rm -rf {}", sh_quote(&staged.dir)));
        }
        result
    }

    /// 停服之后的那几步：备份 → 就位 → 权限 → unit → 起服 → 就绪。
    fn after_staging(&self, staged: &Staged) -> Result<()> {
        self.stop_service()?;
        self.backup()?;
        self.activate(staged)?;
        self.fix_permissions()?;
        self.install_unit()?;
        self.start_service()?;
        self.wait_for_ready()
    }

    fn db(&self) -> Result<Db<'_>> {
        Db::new(self.remote, self.cfg)
    }

    /// 远端库当前的 schema 版本；读不到（没有 sqlite3 等）就是 `None`。
    fn schema_version(&self) -> Option<i64> {
        self.db().ok().and_then(|db| db.user_version())
    }

    // ── Step 1：停服 ──────────────────────────────────────────────

    fn stop_service(&self) -> Result<()> {
        ui::info("停止远端服务…");
        // 首次部署时服务还不存在，stop 失败是正常的
        self.remote.ok(&format!(
            "sudo systemctl stop {} 2>/dev/null || true",
            sh_quote(&self.cfg.app_name)
        ))?;
        ui::done("已停止");
        Ok(())
    }

    // ── Step 2：备份 ──────────────────────────────────────────────

    fn backup(&self) -> Result<()> {
        ui::info("备份当前版本…");
        self.remote
            .ok(&format!("mkdir -p {}", sh_quote(&self.cfg.backup_dir)))?;

        let db = self.db()?;
        // dry-run 下 exists() 恒为假，所以显式让它也走备份分支（那才是要展示的流程）
        if self.remote.is_dry_run() || db.exists() {
            // backup_at 内部先 quick_check：坏库既不该备份、更不该被新版本覆盖。
            // 传本次部署的时间戳：数据库备份与代码备份共用同一个 ts，回滚才能精确配对。
            db.backup_at("deploy", &self.plan.timestamp)?;
        } else {
            ui::info("远端无数据库文件，跳过备份（首次部署）");
        }

        // 这里必须传**原始路径**：`glob_in()` 返回的是已加引号的 shell 语法，
        // 再交给 exists() 加一次引号会变成带字面引号的路径（永远为假）。
        let live_binary = format!("{}/brainbow", self.cfg.service_dir);
        if self.remote.is_dry_run() || self.remote.exists(&live_binary) {
            self.code_archive()?;
        }
        db.prune()?;
        ui::done("备份完成");
        Ok(())
    }

    /// 代码归档：只含 `brainbow` + `dist/`（不含数据库，也不含 76MB 的 ffmpeg）。
    ///
    /// 失败只告警：数据库备份才是硬要求，代码备份缺了不该拦住部署。
    fn code_archive(&self) -> Result<()> {
        let name = stamp::code_filename(&self.plan.timestamp);
        let dest = format!("{}/{}", self.cfg.backup_dir, name);
        let cmd = format!(
            "tar -czf {} -C {} brainbow dist/",
            sh_quote(&dest),
            sh_quote(&self.cfg.service_dir)
        );
        match self.remote.ok(&cmd) {
            Ok(()) => {
                let size = self
                    .remote
                    .capture_if_run(&format!("du -h {} 2>/dev/null | cut -f1", sh_quote(&dest)))
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "?".into());
                ui::info(&format!("代码备份：{name}（{size}）"));
            }
            Err(e) => ui::warn(&format!(
                "代码备份失败（继续部署，但本次无法回滚代码）：{e}"
            )),
        }
        Ok(())
    }

    // ── Step 3-4：传文件（停服前）→ 就位（停服后） ────────────────

    /// 把产物传到远端暂存目录。**这一步服务照常在跑**（见 `critical_path`）。
    fn stage_payload(&self) -> Result<Staged> {
        self.remote
            .ok(&format!("mkdir -p {}", sh_quote(&self.cfg.data_dir)))?;
        sweep_stale_staging(self.cfg, self.remote);

        let staging = format!(
            "{}/deploy_{}",
            self.cfg.remote_tmp_dir(),
            self.plan.timestamp
        );
        self.remote.ok(&format!(
            "rm -rf {s} && mkdir -p {s}",
            s = sh_quote(&staging)
        ))?;

        // 先决定 bin/ 要不要带上（76MB，与远端一致就没必要重传）
        let bin_files = self.bin_files();
        let ship_bin = !bin_files.is_empty() && !self.bin_up_to_date(&bin_files);
        if !bin_files.is_empty() && !ship_bin {
            ui::info("bin/ 与远端一致，跳过上传");
        }

        ui::info("同步前端 + 后端（服务仍在运行）…");
        let build = self.cfg.build_dir();
        let payload = Payload {
            binary: build.join("brainbow"),
            dist: build.join("dist"),
            bin: &bin_files,
            ship_bin,
        };
        self.remote.send_tar(
            &format!("tar -xzf - -C {}", sh_quote(&staging)),
            if ship_bin {
                "产物（binary + dist + bin）"
            } else {
                "产物（binary + dist）"
            },
            |archive| write_payload(archive, &payload),
        )?;

        // 校验解出来的东西：上传被截断在这里就被拦住（不会走到"换成半个二进制"）
        if self.remote.is_dry_run() {
            ui::info("（dry-run：跳过上传后的校验）");
        } else {
            let staged_binary = path_of(&staging, "brainbow");
            if !self
                .remote
                .condition(&format!("[ -s {} ]", sh_quote(&staged_binary)))
            {
                return Err(Error::msg(
                    "上传后暂存目录里没有 brainbow（传输被截断？已中止，运行目录未动）",
                ));
            }
            if !self.remote.condition(&format!(
                "[ -f {} ]",
                sh_quote(&path_of(&staging, "dist/index.html"))
            )) {
                return Err(Error::msg(
                    "上传后暂存目录里没有 dist/index.html（前端产物没传上去？已中止）",
                ));
            }
        }

        ui::done("产物已上传到暂存目录");
        Ok(Staged {
            dir: staging,
            bin: bin_files,
        })
    }

    /// 把暂存目录里的东西挪到运行位置，然后收掉暂存目录。
    fn activate(&self, staged: &Staged) -> Result<()> {
        let staging = &staged.dir;
        // mv 在同一文件系统内是原子改名：不会出现"服务读到半个二进制"
        self.remote.ok(&format!(
            "mv -f {} {}",
            sh_quote(&path_of(staging, "brainbow")),
            sh_quote(&path_of(&self.cfg.service_dir, "brainbow"))
        ))?;
        activate_dist(self.cfg, self.remote, staging)?;

        let staged_bin = path_of(staging, "bin");
        if !staged.bin.is_empty() && (self.remote.is_dry_run() || self.remote.exists(&staged_bin)) {
            let bin_dir = path_of(&self.cfg.service_dir, "bin");
            // 不带 --delete 语义：远端 bin/ 里若还有别的东西，不该被这次部署删掉
            self.remote.ok(&format!(
                "mkdir -p {b} && mv -f {g} {b}/",
                b = sh_quote(&bin_dir),
                g = glob_in(&staged_bin, "*")
            ))?;
        }

        let _ = self.remote.ok(&format!("rm -rf {}", sh_quote(staging)));
        ui::done("同步完成");
        Ok(())
    }

    /// 本地有哪些 `bin/` 文件要随产物走（取决于 WITH_FFPROBE）。
    fn bin_files(&self) -> Vec<(PathBuf, String)> {
        let vendor = self.cfg.project_dir.join("vendor/ffmpeg/bin");
        let wants_ffprobe = std::env::var("WITH_FFPROBE").is_ok_and(|value| value == "1");
        [("ffmpeg", true), ("ffprobe", wants_ffprobe)]
            .into_iter()
            .filter(|(_, wanted)| *wanted)
            .map(|(name, _)| (vendor.join(name), name.to_string()))
            .filter(|(path, _)| local::is_executable(path))
            .collect()
    }

    /// 远端 `bin/` 是否已与本地一致（逐个比 sha256）。
    fn bin_up_to_date(&self, files: &[(PathBuf, String)]) -> bool {
        files.iter().all(|(path, name)| {
            let Ok(local_hash) = local::sha256(path) else {
                return false;
            };
            let remote_hash = self
                .remote
                .capture_if_run(&format!(
                    "sha256sum {} 2>/dev/null",
                    sh_quote(&path_of(&format!("{}/bin", self.cfg.service_dir), name))
                ))
                .ok()
                .flatten();
            remote_hash
                .and_then(|out| out.split_whitespace().next().map(str::to_string))
                .is_some_and(|hash| hash == local_hash)
        })
    }

    // ── Step 5：权限 ──────────────────────────────────────────────

    /// Step 5：可执行位。
    ///
    /// `dist/` 的权限由 `activate_dist` 在换目录那一步设好（那里是唯一知道
    /// "刚刚换上去的是哪个目录"的地方），这里只补 `brainbow` 与 `bin/`。
    fn fix_permissions(&self) -> Result<()> {
        ui::info("设置权限…");
        let service = &self.cfg.service_dir;
        self.remote.ok(&chmod_binary_command(service))?;

        // dry-run 下 exists() 恒为假，只看它会把这条命令从预览里漏掉 ——
        // 而"漏掉的那条恰好是错的"正是上次部署失败的经过。
        let bin_dir = path_of(service, "bin");
        if self.remote.is_dry_run() || self.remote.exists(&bin_dir) {
            self.remote.ok(&chmod_bin_command(service))?;
        }
        ui::done("权限设置完成");
        Ok(())
    }

    // ── Step 6-7：装 unit 并起服 ──────────────────────────────────

    fn install_unit(&self) -> Result<()> {
        ui::info("更新 systemd unit（模板 deploy/brainbow.service）…");
        let unit_path = self.cfg.unit_path();
        self.remote
            .write_file_sudo(&unit_path, self.plan.unit.as_bytes(), "systemd unit")?;
        // unit 里含 JWT 密钥，限 root 可读
        self.remote
            .ok(&format!("sudo chmod 600 {}", sh_quote(&unit_path)))?;
        Ok(())
    }

    fn start_service(&self) -> Result<()> {
        ui::info("启动服务…");
        let app = sh_quote(&self.cfg.app_name);
        self.remote.ok(&format!(
            "sudo systemctl daemon-reload && sudo systemctl enable {app} && sudo systemctl start {app}"
        ))?;
        ui::done("服务已启动");
        Ok(())
    }

    // ── Step 8：等就绪 ────────────────────────────────────────────

    fn wait_for_ready(&self) -> Result<()> {
        wait_for_ready(self.cfg, self.remote)
    }

    // ── 关键区失败后的恢复 ────────────────────────────────────────

    /// 两层恢复，顺序与老脚本一致：先试着把现有产物拉起来（旧产物还在磁盘上时
    /// 这一层就够了），不行再回滚到本次部署前的代码备份，再不行交给人。
    ///
    /// 回滚代码时**可能连数据库一起回**（见 `paired_db`）：迁移把库带到了新版，
    /// 而"库版本高于程序支持版本"是拒绝启动的，所以只回代码等于没回。
    fn recover(&self, schema_before: Option<i64>) -> Result<()> {
        let app = sh_quote(&self.cfg.app_name);
        let _ = self.remote.ok(&format!(
            "sudo systemctl restart {app} 2>/dev/null || sudo systemctl start {app}"
        ));
        if self.remote.is_dry_run() {
            return Err(Error::msg("dry-run：未执行恢复"));
        }
        // 必须给足时间：服务起来要 bind 端口、开库、跑启动自检。
        // 早先这里只探一次，于是"只是还没起来"被误判成"起不来"，
        // 白白回滚了一次（老脚本这一层用的是完整的 wait_for_ready）。
        if self.wait_for_ready().is_ok() {
            ui::warn("服务已用当前磁盘上的产物拉起（新版本可能有问题，请查日志）");
            return Ok(());
        }

        let code = stamp::code_stem(&self.plan.timestamp);
        if !self
            .remote
            .exists(&format!("{}/{}.tar.gz", self.cfg.backup_dir, code))
        {
            return Err(Error::msg(
                "当前产物起不来，且没有本次部署前的代码备份 —— 请人工介入：`just logs` / `just rollback`",
            ));
        }
        let pair = rollback::Pair {
            code: Some(code),
            db: self.paired_db(schema_before),
        };
        ui::warn(&format!("当前产物起不来，回滚：{}…", pair.describe()));
        // 用 apply 而不是 restore_code：它会把服务重新拉起来
        // （只换文件不重启的话，跑的还是内存里那个坏掉的二进制）
        rollback::apply(self.cfg, self.remote, &pair)?;
        self.wait_for_ready()
    }

    /// 自动恢复时要一起还原的数据库备份（`db_deploy_<ts>`），没有就是 `None`。
    ///
    /// 只在**这次部署动过 schema** 时才带。道理：迁移的版本闸门是"库版本高于
    /// 程序支持版本就拒绝启动"，而代码回滚之后恰好就是"旧代码 + 新库"——
    /// 旧二进制必然起不来，两层恢复全废。反过来，schema 没动过时不该去覆盖
    /// 用户数据：备份是停服后拍的（那一刻起没有写入），但恢复前服务已经跑过
    /// 一小会儿，那期间的写入只存在于现网库里。
    ///
    /// 读不到 schema 版本（远端没有 sqlite3）时按"动过"处理 —— 宁可多回一份库，
    /// 也不要留一个必然起不来的组合。
    fn paired_db(&self, schema_before: Option<i64>) -> Option<String> {
        if !needs_db_restore(schema_before, self.schema_version()) {
            return None;
        }
        let stem = stamp::db_stem("deploy", &self.plan.timestamp);
        // 首次部署没有库可备份 —— 那正是 `pair.db = None` 的正常情形
        self.remote
            .exists(&format!("{}/{}", self.cfg.backup_dir, stem))
            .then_some(stem)
    }

    // ── 就绪之后的只读收尾 ────────────────────────────────────────

    /// 跑已部署二进制的只读自检。
    ///
    /// 环境要对齐 systemd 的 unit：`cd` 到它的 `WorkingDirectory`，并把
    /// **影响路径的环境变量**显式传进去 —— `DATABASE_URL` 与 `UPLOAD_DIR`。
    /// 少传一个是真实的坑：不传 `UPLOAD_DIR` 时自检会退回默认的相对路径
    /// `uploads`（相对 cwd = service/），于是去检查一个跟服务实际使用的目录
    /// 无关的地方，报出假的"上传目录不可用 / 缺失 32 个文件"。
    fn self_check(&self) {
        ui::info("后端自检（只读，含全库 quick_check，约数秒）…");
        let cmd = format!(
            "cd {} && RUST_LOG=info DATABASE_URL={} UPLOAD_DIR={} ./brainbow --check 2>&1",
            sh_quote(&self.cfg.service_dir),
            sh_quote(&self.cfg.database_url),
            sh_quote(&self.cfg.upload_dir)
        );
        match self.remote.capture_any(&cmd) {
            Ok(None) => ui::info("后端自检（dry-run 未执行）"),
            Ok(Some((out, true))) => {
                ui::done("后端自检通过");
                // 只把分段小结打出来（`[1/5] …`），其余交给 --check 的原始输出。
                // 段数是会变的（加缩略图缓存检查那批就从 /4 变成了 /5），
                // 所以按形状认，不写死数字 —— 写死过一次，结果是那几行静默地
                // 一行都不显示，而"自检通过"照打。
                for line in out.lines().filter(|line| is_summary_line(line)) {
                    ui::info(strip_ansi(line).trim());
                }
            }
            Ok(Some((out, false))) => {
                // 只告警不回滚：它报的是数据层问题（缺文件、孤儿、schema 漂移），
                // 回滚代码解决不了，而服务本身是好的。
                ui::warn("后端自检未通过（服务已在运行，部署不回滚）：");
                ui::raw(&out);
                ui::info(&format!(
                    "可复跑：ssh {} \"cd {} && DATABASE_URL={} ./brainbow --check\"",
                    self.cfg.target(),
                    self.cfg.service_dir,
                    self.cfg.database_url
                ));
            }
            Err(e) => ui::warn(&format!("后端自检跑不起来：{e}")),
        }
    }

    fn optimize(&self) {
        let result = self.db().and_then(|db| db.optimize());
        if let Err(e) = result {
            ui::warn(&format!("PRAGMA optimize 失败（不阻断部署）：{e}"));
        }
    }

    fn sync_caddy(&self) {
        if caddy::sync(self.cfg, self.remote, &self.plan.caddyfile).is_err() {
            ui::warn("Caddy 配置未更新（现网配置保持原样）");
            return;
        }
        match caddy::reload(self.remote) {
            Ok(()) => ui::done("Caddy 已重载"),
            Err(e) => ui::warn(&format!("Caddy 重载失败：{e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一棵假的 `build/` 树。
    fn fake_build(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("xtask-payload-{tag}-{}", std::process::id()));
        let build = root.join("build");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(build.join("dist/assets")).expect("建目录");
        std::fs::create_dir_all(build.join("bin")).expect("建目录");
        std::fs::write(build.join("brainbow"), vec![0u8; 1024]).expect("写");
        std::fs::write(build.join("dist/index.html"), b"<html>").expect("写");
        std::fs::write(build.join("dist/assets/a.js"), b"console.log(1)").expect("写");
        std::fs::write(build.join("bin/ffmpeg"), vec![0u8; 2048]).expect("写");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for name in ["brainbow", "bin/ffmpeg"] {
                let path = build.join(name);
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .expect("改权限");
            }
        }
        root
    }

    /// 归档里的条目名与本地路径无关 —— 远端就按这些名字就位。
    #[test]
    fn payload_archive_has_the_expected_entries() {
        let root = fake_build("names");
        let build = root.join("build");
        let files = vec![(build.join("bin/ffmpeg"), "ffmpeg".to_string())];
        let payload = Payload {
            binary: build.join("brainbow"),
            dist: build.join("dist"),
            bin: &files,
            ship_bin: true,
        };

        let mut buf = Vec::new();
        {
            let mut archive = tar::Builder::new(&mut buf);
            write_payload(&mut archive, &payload).expect("打包应当成功");
            archive.finish().expect("收尾应当成功");
        }

        let mut names: Vec<String> = tar::Archive::new(buf.as_slice())
            .entries()
            .expect("读归档")
            .map(|entry| {
                entry
                    .expect("条目")
                    .path()
                    .expect("路径")
                    .display()
                    .to_string()
            })
            .collect();
        names.sort();

        assert_eq!(
            names,
            vec![
                // `bin/` 没有单独的目录条目：tar 解包时会自动建中间目录，
                // 所以远端 `tar -xzf` 之后 deploy_x/bin/ 照样在
                "bin/ffmpeg",
                "brainbow",
                "dist/",
                "dist/assets",
                "dist/assets/a.js",
                "dist/index.html",
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 回滚要不要连数据库一起：判断错了两个方向都贵 —— 该带不带（旧代码 +
    /// 新库，起不来），不该带却带（覆盖掉用户数据）。
    #[test]
    fn db_restore_follows_the_schema_version() {
        // 没动过 schema：只回代码
        assert!(!needs_db_restore(Some(19), Some(19)));
        // 跑过迁移（19 → 20）：必须连库一起回
        assert!(needs_db_restore(Some(19), Some(20)));
        // 读不到现网版本：按"动过"处理
        assert!(needs_db_restore(Some(19), None));
        // 停服前就读不到（远端没有 sqlite3）：同样按"动过"处理
        assert!(needs_db_restore(None, Some(19)));
        assert!(needs_db_restore(None, None));
        // 反向迁移（不该发生，但方向也要对）：也得连库一起回
        assert!(needs_db_restore(Some(20), Some(19)));
    }

    #[test]
    fn strips_ansi_escapes() {
        assert_eq!(
            strip_ansi("\u{1b}[2m2026-01-01T00:00:00Z\u{1b}[0m 正文"),
            "2026-01-01T00:00:00Z 正文"
        );
        assert_eq!(
            strip_ansi("\u{1b}[32m INFO\u{1b}[0m [1/5] x"),
            " INFO [1/5] x"
        );
        // 没有转义序列时原样返回
        assert_eq!(strip_ansi("plain"), "plain");
        // 落单的 ESC 不该吞掉后面的字符
        assert_eq!(strip_ansi("a\u{1b}b"), "ab");
    }

    #[test]
    fn summary_line_matches_the_shape_not_a_hardcoded_count() {
        // 真实输出（新版本 5 段、老版本 4 段都要认）
        assert!(is_summary_line(
            "2026-09-21T14:53:51.653427Z  INFO [1/5] 数据库 schema: schema 版本 19/19；表齐全"
        ));
        assert!(is_summary_line(
            "\u{1b}[2m2026-09-21T13:42:33.884224Z\u{1b}[0m \u{1b}[32m INFO\u{1b}[0m [2/4] 完整性 quick_check: ok"
        ));
        assert!(is_summary_line("[12/12] 某段: ok"));
        // 其它日志行不该被误认
        assert!(!is_summary_line(
            "2026-09-21T13:42:33Z  INFO 已从数据库加载记忆配置，FSRS 参数数: 21"
        ));
        assert!(!is_summary_line("INFO Listening on http://127.0.0.1:8080"));
        assert!(!is_summary_line("schema 版本 19/19；表齐全"));
        assert!(!is_summary_line("[abc/def] 不是数字"));
        assert!(!is_summary_line("[1/5 少了个括号"));
    }

    /// 权限命令里不该出现重复的 glob —— `'dir'/*/*` 匹配不到任何东西，
    /// 而 chmod 会因此报错、把整步权限设置弄失败（真实踩过一次）。
    #[test]
    fn permission_commands_do_not_double_the_glob() {
        let commands = [
            chmod_binary_command("/opt/brb/service"),
            chmod_dist_command("/opt/brb/service"),
            chmod_bin_command("/opt/brb/service"),
        ];
        for command in &commands {
            assert!(!command.contains("*/*"), "glob 重复了：{command}");
        }
        assert_eq!(
            chmod_bin_command("/opt/brb/service"),
            "chmod 755 '/opt/brb/service/bin'/*"
        );
        assert_eq!(
            chmod_binary_command("/opt/brb/service"),
            "chmod 755 '/opt/brb/service/brainbow'"
        );
        // dist 的扫描只针对 dist，不能扫整个 service（那会改动 uploads 里用户上传的文件）
        let dist = chmod_dist_command("/opt/brb/service");
        assert!(dist.contains("'/opt/brb/service/dist'"), "{dist}");
        assert!(!dist.contains("'/opt/brb/service' "), "{dist}");
        assert_eq!(dist.matches("/opt/brb/service/dist").count(), 2, "{dist}");
    }

    #[test]
    fn payload_omits_bin_when_not_shipping_it() {
        let root = fake_build("nobin");
        let build = root.join("build");
        let files = vec![(build.join("bin/ffmpeg"), "ffmpeg".to_string())];
        let payload = Payload {
            binary: build.join("brainbow"),
            dist: build.join("dist"),
            bin: &files,
            ship_bin: false,
        };

        let mut buf = Vec::new();
        {
            let mut archive = tar::Builder::new(&mut buf);
            write_payload(&mut archive, &payload).expect("打包应当成功");
            archive.finish().expect("收尾应当成功");
        }

        let names: Vec<String> = tar::Archive::new(buf.as_slice())
            .entries()
            .expect("读归档")
            .map(|entry| {
                entry
                    .expect("条目")
                    .path()
                    .expect("路径")
                    .display()
                    .to_string()
            })
            .collect();
        assert!(
            names.iter().all(|name| !name.starts_with("bin")),
            "不该带 bin/：{names:?}"
        );
        assert!(names.iter().any(|name| name == "brainbow"), "{names:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 可执行位必须活着到达远端 —— 否则 `./brainbow` 起不来。
    #[cfg(unix)]
    #[test]
    fn payload_keeps_the_executable_bit() {
        let root = fake_build("mode");
        let build = root.join("build");
        let files = vec![(build.join("bin/ffmpeg"), "ffmpeg".to_string())];
        let payload = Payload {
            binary: build.join("brainbow"),
            dist: build.join("dist"),
            bin: &files,
            ship_bin: true,
        };

        let mut buf = Vec::new();
        {
            let mut archive = tar::Builder::new(&mut buf);
            write_payload(&mut archive, &payload).expect("打包应当成功");
            archive.finish().expect("收尾应当成功");
        }

        for entry in tar::Archive::new(buf.as_slice()).entries().expect("读归档") {
            let entry = entry.expect("条目");
            let name = entry.path().expect("路径").display().to_string();
            if name == "brainbow" || name == "bin/ffmpeg" {
                let mode = entry.header().mode().expect("权限位");
                assert!(mode & 0o111 != 0, "{name} 的可执行位丢了（mode={mode:o}）");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
