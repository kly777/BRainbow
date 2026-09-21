//! `deploy` —— 全量部署。
//!
//! 步骤与 deploy.sh 的 `cmd_deploy`（362-496）一一对应，**顺序不变**：
//! 停服 → 体检 → 备份 → 清理 → 传文件 → 权限 → 装 unit → 起服 → 等就绪
//! →（只读自检 / 优化 / 同步 Caddy，失败只告警）。
//!
//! 三处刻意的改动：
//! 1. **传输不用 rsync**：进程内打 tar.gz 灌进 ssh 的 stdin（本机不需要
//!    rsync/scp/sftp，Windows 上也就没有"没有 rsync"这回事）。`ffmpeg` 有
//!    76MB，老实现靠 rsync 的 mtime+size 跳过它，所以这里显式比 sha256 ——
//!    一致就不带，不然每次部署白传 76MB。
//! 2. **先传暂存目录再就位**，而不是原地覆盖。传输或解包中断不会留下半个
//!    二进制；`dist` 换目录用 `.old` 过渡，中间那一瞬旧目录还在手边。
//! 3. **恢复是显式的 `Result` 处理**，不是 bash 的 `ERR` trap。老写法的
//!    trap 刻意避开"显式 exit"，于是"哪些失败会触发回滚"很难讲清楚；这里
//!    只有关键区（停服 → 就绪）会触发恢复，服务就绪之后的事情一律只告警。

use std::path::PathBuf;
use std::time::Duration;

use crate::caddy;
use crate::config::Config;
use crate::db::{Db, utc_stamp};
use crate::error::{Error, Result};
use crate::local;
use crate::remote::{Remote, glob_in, path_of, sh_quote};
use crate::render;
use crate::rollback;
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
    // 只对 dist 做 —— 老脚本的 `find $SERVICE_DIR` 会把 uploads 里用户上传的
    // 文件也一起改成 644。
    remote.ok(&format!(
        "find {d} -type d -exec chmod 755 {{}} + ; find {d} -type f -exec chmod 644 {{}} +",
        d = sh_quote(&live)
    ))?;
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

/// 就绪探测次数与间隔（与老脚本一致：30 次 × 1 秒）。
const READY_ATTEMPTS: u32 = 30;
const READY_INTERVAL: Duration = Duration::from_secs(1);

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
        // 关键区：停服 → 就绪。这里任何一步失败都要走自动恢复。
        if let Err(err) = self.critical_path() {
            ui::warn("部署中途失败，尝试自动恢复…");
            match self.recover() {
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
        self.stop_service()?;
        self.backup()?;
        self.stage_payload()?;
        self.fix_permissions()?;
        self.install_unit()?;
        self.start_service()?;
        self.wait_for_ready()
    }

    fn db(&self) -> Result<Db<'_>> {
        Db::new(self.remote, self.cfg)
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
            // backup() 内部先 quick_check：坏库既不该备份、更不该被新版本覆盖
            db.backup("deploy")?;
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
        let name = format!("code_{}.tar.gz", self.plan.timestamp);
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

    // ── Step 3-4：传文件并就位 ────────────────────────────────────

    fn stage_payload(&self) -> Result<()> {
        self.remote
            .ok(&format!("mkdir -p {}", sh_quote(&self.cfg.data_dir)))?;

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

        ui::info("同步前端 + 后端…");
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

        self.activate(&staging, &bin_files)?;
        let _ = self.remote.ok(&format!("rm -rf {}", sh_quote(&staging)));
        ui::done("同步完成");
        Ok(())
    }

    /// 把暂存目录里的东西挪到运行位置。
    fn activate(&self, staging: &str, bin_files: &[(PathBuf, String)]) -> Result<()> {
        // mv 在同一文件系统内是原子改名：不会出现"服务读到半个二进制"
        self.remote.ok(&format!(
            "mv -f {} {}",
            sh_quote(&path_of(staging, "brainbow")),
            sh_quote(&path_of(&self.cfg.service_dir, "brainbow"))
        ))?;
        activate_dist(self.cfg, self.remote, staging)?;

        let staged_bin = path_of(staging, "bin");
        if !bin_files.is_empty() && (self.remote.is_dry_run() || self.remote.exists(&staged_bin)) {
            let bin_dir = path_of(&self.cfg.service_dir, "bin");
            // 不带 --delete 语义：远端 bin/ 里若还有别的东西，不该被这次部署删掉
            self.remote.ok(&format!(
                "mkdir -p {b} && mv -f {g} {b}/",
                b = sh_quote(&bin_dir),
                g = glob_in(&staged_bin, "*")
            ))?;
        }
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

    fn fix_permissions(&self) -> Result<()> {
        ui::info("设置权限…");
        let service = &self.cfg.service_dir;
        self.remote.ok(&format!(
            "chmod 755 {}",
            sh_quote(&path_of(service, "brainbow"))
        ))?;

        // dist 由 Caddy 以另一个用户（caddy）读取，需要目录 755 / 文件 644。
        // 只对 dist 做，不整目录 find —— 老脚本的
        // `find $SERVICE_DIR -type f -exec chmod 644` 会把 uploads 里
        // 用户上传的文件也一起改掉。
        let dist = format!("{service}/dist");
        self.remote.ok(&format!(
            "find {d} -type d -exec chmod 755 {{}} + ; find {d} -type f -exec chmod 644 {{}} +",
            d = sh_quote(&dist)
        ))?;

        let bin_dir = format!("{service}/bin");
        if self.remote.exists(&bin_dir) {
            self.remote
                .ok(&format!("chmod 755 {}/*", glob_in(&bin_dir, "*")))?;
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

    /// 探测一次 `/api/health`；dry-run 返回 `None`。
    fn probe_health(&self) -> Result<Option<bool>> {
        probe_health(self.cfg, self.remote)
    }

    // ── 关键区失败后的恢复 ────────────────────────────────────────

    /// 两层恢复，顺序与老脚本一致：先试着把现有产物拉起来（旧产物还在磁盘上时
    /// 这一层就够了），不行再回滚到本次部署前的代码备份，再不行交给人。
    fn recover(&self) -> Result<()> {
        let app = sh_quote(&self.cfg.app_name);
        let _ = self.remote.ok(&format!(
            "sudo systemctl restart {app} 2>/dev/null || sudo systemctl start {app}"
        ));
        match self.probe_health() {
            Ok(Some(true)) => {
                ui::warn("服务已用当前磁盘上的产物拉起（新版本可能有问题，请查日志）");
                return Ok(());
            }
            Ok(None) => return Err(Error::msg("dry-run：未执行恢复")),
            _ => {}
        }

        let stem = format!("code_{}", self.plan.timestamp);
        if !self
            .remote
            .exists(&format!("{}/{stem}.tar.gz", self.cfg.backup_dir))
        {
            return Err(Error::msg(
                "当前产物起不来，且没有本次部署前的代码备份 —— 请人工介入：`just logs` / `just rollback`",
            ));
        }
        ui::warn(&format!("当前产物起不来，回滚到 {stem}…"));
        // 用 apply 而不是 restore_code：它会把服务重新拉起来
        // （只换文件不重启的话，跑的还是内存里那个坏掉的二进制）
        rollback::apply(
            self.cfg,
            self.remote,
            &rollback::Pair {
                code: Some(stem),
                db: None,
            },
        )?;
        self.wait_for_ready()
    }

    // ── 就绪之后的只读收尾 ────────────────────────────────────────

    /// 跑已部署二进制的只读自检。
    ///
    /// 环境对齐 systemd：`cd` 到 unit 的 `WorkingDirectory`（`UPLOAD_DIR` 默认是
    /// 相对该目录的路径），并显式传入 `DATABASE_URL`。
    fn self_check(&self) {
        ui::info("后端自检（只读，含全库 quick_check，约数秒）…");
        let cmd = format!(
            "cd {} && RUST_LOG=info DATABASE_URL={} ./brainbow --check 2>&1",
            sh_quote(&self.cfg.service_dir),
            sh_quote(&self.cfg.database_url)
        );
        match self.remote.capture_any(&cmd) {
            Ok(None) => ui::info("后端自检（dry-run 未执行）"),
            Ok(Some((out, true))) => {
                ui::done("后端自检通过");
                // 只把四段小结打出来（`[1/4] …`），其余交给 --check 的原始输出
                for line in out.lines().filter(|line| line.contains("/4]")) {
                    ui::info(line.trim());
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
