//! 远端执行。
//!
//! 与 deploy.sh 的关键差别：**本地侧不再有 shell**。
//! 老脚本把 `SSH_CMD="ssh -p $PORT $USER@$HOST"` 拼成字符串再用 `$SSH_CMD "$@"`
//! 做词拆分，还处处 `eval` 拼 rsync 命令 —— 路径带空格就断。
//! 这里 ssh 用 **argv 数组**起（无 shell、无词拆分、无 eval）。
//!
//! 远端那一侧仍然是一条被远端 shell 解析的命令串，这是 ssh 的固有形态，
//! 所以**任何插值都必须过 `sh_quote`**；字面部分（`awk '{print $1}'` 之类）
//! 则可以是干净的原文，不再需要 deploy.sh 里那层层叠叠的 `\$` 转义。

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use flate2::Compression;
use flate2::write::GzEncoder;

use crate::config::Config;
use crate::error::{Error, Result};
use crate::ui;

/// 上传用的 tar 归档：gzip 压缩，目标是 ssh 子进程的 stdin。
pub type Archive = tar::Builder<GzEncoder<std::process::ChildStdin>>;

pub struct Remote {
    host: String,
    user: String,
    port: u16,
    dry_run: bool,
}

impl Remote {
    /// 从配置里取目标信息**自持**（只拷几个字符串），因此 `Remote` 没有生命周期
    /// 参数 —— 把它放进别的结构体时不必再纠结借用关系。
    pub fn new(cfg: &Config, dry_run: bool) -> Self {
        Self {
            host: cfg.remote_host.clone(),
            user: cfg.remote_user.clone(),
            port: cfg.remote_port,
            dry_run,
        }
    }

    pub fn target(&self) -> String {
        format!("{}@{}", self.user, self.host)
    }

    /// 供 dry-run 展示与测试使用：完整的 ssh argv。
    pub fn argv(&self, cmd: &str) -> Vec<String> {
        vec![
            "-p".to_string(),
            self.port.to_string(),
            self.target(),
            cmd.to_string(),
        ]
    }

    /// 是否 dry-run（只打印、不执行）。
    ///
    /// 调用方需要它来区分"检查没过"与"检查没跑"：dry-run 时 `condition()`
    /// 一律为假、`capture()` 一律为空，若照着分支判断就会报出假失败。
    pub fn is_dry_run(&self) -> bool {
        self.dry_run
    }

    /// 执行远端命令并返回 stdout（已去掉首尾空白）。非零退出即失败。
    /// dry-run 时命令没跑，返回空串。
    pub fn capture(&self, cmd: &str) -> Result<String> {
        Ok(self.capture_if_run(cmd)?.unwrap_or_default())
    }

    /// 执行远端命令，只关心成不成功。
    pub fn ok(&self, cmd: &str) -> Result<()> {
        self.exec(cmd).map(|_| ())
    }

    /// 同 `capture`，但 dry-run 时返回 `None`。
    ///
    /// 给"按输出打分"的检查用：dry-run 下命令没执行，不该把空输出判成失败，
    /// 调用方看到 `None` 就报"未执行"。
    pub fn capture_if_run(&self, cmd: &str) -> Result<Option<String>> {
        Ok(self.exec(cmd)?.map(|(stdout, _)| stdout))
    }

    /// 远端路径是否存在（`[ -e path ]`）。
    ///
    /// **传原始路径值**（例如 `format!("{dir}/name")`），不要传 `glob_in()` /
    /// `sh_quote()` 的结果 —— 那是已加引号的 shell 语法，再引一次会变成
    /// 带字面引号的路径，判断会永远为假。
    pub fn exists(&self, path: &str) -> bool {
        debug_assert!(
            !path.contains('\''),
            "exists() 收到含引号的路径（{path}）：很可能把 glob_in()/sh_quote() 的结果又传进来了"
        );
        self.condition(&format!("[ -e {} ]", sh_quote(path)))
    }

    /// 跑一条"判断类"远端命令（如 `[ -f x ]`），只看真假。
    ///
    /// dry-run 时返回 `false`：没执行就当作"不确定/不存在"，调用方据此跳过的
    /// 都是可跳过的步骤。
    pub fn condition(&self, test: &str) -> bool {
        self.capture(&format!("{test} && echo yes || echo no"))
            .map(|out| out == "yes")
            .unwrap_or(false)
    }

    /// 跑远端命令，返回 stdout 与"是否成功"；命令压根跑不起来才是 `Err`。
    ///
    /// 用于"退出码本身有意义、但输出才是要看的东西"的场景 ——
    /// 例如 `brainbow --check` 用非零退出码报告数据层问题，可我们正要看它的输出。
    pub fn capture_any(&self, cmd: &str) -> Result<Option<(String, bool)>> {
        Ok(self
            .exec_raw(cmd)?
            .map(|(stdout, _, status)| (stdout, status.success())))
    }

    /// 把字节流写进远端命令的 stdin。
    ///
    /// 远端命令通常长这样：`tar -xzf - -C <dir>`、`cat > <file>`、
    /// `sudo tee <file> > /dev/null`。本机因此不需要 scp/sftp。
    ///
    /// stdout/stderr 直接继承终端：不吃管道，大文件上传就不存在
    /// "我们写 stdin 卡住、子进程又在等 stdout 被读"的死锁；而且远端
    /// （tar/gzip）自己的报错能原样显示出来。
    pub fn send_stdin(&self, cmd: &str, content: &[u8], label: &str) -> Result<()> {
        if self.dry_run {
            ui::dry_run(&format!(
                "ssh {} {}   ← {} 字节（{label}）",
                self.argv(cmd).join(" "),
                "",
                content.len()
            ));
            return Ok(());
        }
        let mut child = self.spawn_stdin_child(cmd)?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::msg("ssh 子进程没有 stdin 管道"))?;
        let written = stdin
            .write_all(content)
            .map_err(|e| Error::io("写入 ssh stdin", e));
        drop(stdin); // 关掉写端，远端命令才会读到 EOF
        let status = child.wait().map_err(|e| Error::io("等待 ssh 结束", e))?;
        finish_upload(written, status, label)
    }

    /// 上传一段 tar.gz：**进程内打包**并流式写进 ssh 的 stdin。
    ///
    /// 全程 O(1) 内存（不会把 76MB 的 ffmpeg 先缓在内存里），本机也不需要
    /// rsync —— 只要有系统自带的 ssh 客户端。
    pub fn send_tar<F>(&self, cmd: &str, label: &str, build: F) -> Result<()>
    where
        F: FnOnce(&mut Archive) -> Result<()>,
    {
        if self.dry_run {
            ui::dry_run(&format!(
                "ssh {}   ← tar.gz 流（{label}）",
                self.argv(cmd).join(" ")
            ));
            return Ok(());
        }
        let mut child = self.spawn_stdin_child(cmd)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::msg("ssh 子进程没有 stdin 管道"))?;

        // 压缩级别用 fast：这里是本机 → 远端的一次性传输，编译期省下的时间
        // 比多压几个百分点值钱（ffmpeg 那 76MB 也就几秒）。
        let mut archive = tar::Builder::new(GzEncoder::new(stdin, Compression::fast()));
        let built = build(&mut archive).and_then(|()| {
            let gz = archive
                .into_inner()
                .map_err(|e| Error::io("收尾 tar 归档", e))?;
            // 必须显式 finish：直接 drop 会丢掉 gzip 尾部，远端解不出来
            let stdin = gz.finish().map_err(|e| Error::io("收尾 gzip 流", e))?;
            drop(stdin);
            Ok(())
        });

        let status = child.wait().map_err(|e| Error::io("等待 ssh 结束", e))?;
        finish_upload(built, status, label)
    }

    fn spawn_stdin_child(&self, cmd: &str) -> Result<std::process::Child> {
        Command::new("ssh")
            .args(self.argv(cmd))
            .stdin(Stdio::piped())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| Error::io("启动 ssh（确认 PATH 里有 OpenSSH 客户端）", e))
    }

    /// 把本地文件流式送进远端命令的 stdin（大文件不进内存）。
    ///
    /// 用于 `db-push` 那种要推上百 MB 文件的场景；产物上传走 `send_tar`
    /// （需要打包多个文件）。
    pub fn send_file(&self, cmd: &str, local: &Path, label: &str) -> Result<()> {
        if self.dry_run {
            let size = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0);
            ui::dry_run(&format!(
                "ssh {}   ← {}（{label}，{size} 字节）",
                self.argv(cmd).join(" "),
                local.display()
            ));
            return Ok(());
        }
        let file = std::fs::File::open(local)
            .map_err(|e| Error::io(format!("打开 {}", local.display()), e))?;
        let mut reader = std::io::BufReader::new(file);

        let mut child = self.spawn_stdin_child(cmd)?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::msg("ssh 子进程没有 stdin 管道"))?;
        let copied = std::io::copy(&mut reader, &mut stdin)
            .map_err(|e| Error::io(format!("上传 {label}"), e));
        drop(stdin);
        let status = child.wait().map_err(|e| Error::io("等待 ssh 结束", e))?;
        finish_upload(copied.map(|_| ()), status, label)
    }

    /// 把远端命令的 stdout 流式写到本地文件（二进制安全）。
    ///
    /// 用 `ssh host 'cat <file>'` 而不是 scp：本机因此不需要 scp。stderr 直接
    /// 继承终端，失败时能看见原因。
    pub fn download(&self, cmd: &str, dest: &Path, label: &str) -> Result<()> {
        if self.dry_run {
            ui::dry_run(&format!(
                "ssh {}   → {}（{label}）",
                self.argv(cmd).join(" "),
                dest.display()
            ));
            return Ok(());
        }
        let mut child = Command::new("ssh")
            .args(self.argv(cmd))
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| Error::io("启动 ssh（确认 PATH 里有 OpenSSH 客户端）", e))?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::msg("ssh 子进程没有 stdout 管道"))?;

        let mut file = std::fs::File::create(dest)
            .map_err(|e| Error::io(format!("创建 {}", dest.display()), e))?;
        let copied = std::io::copy(&mut stdout, &mut file)
            .map_err(|e| Error::io(format!("下载 {label}"), e));
        drop(file);
        let status = child.wait().map_err(|e| Error::io("等待 ssh 结束", e))?;

        if !status.success() {
            // 半截文件没有意义，删掉免得被当成一个可用的备份
            let _ = std::fs::remove_file(dest);
            return Err(Error::msg(format!(
                "下载 {label} 失败：远端命令退出码 {}",
                exit_code(&status)
            )));
        }
        copied.map(|_| ())
    }

    /// 把内容写成远端文件（`cat > path`）—— 不需要 scp/sftp。
    pub fn write_file(&self, path: &str, content: &[u8], label: &str) -> Result<()> {
        self.send_stdin(&format!("cat > {}", sh_quote(path)), content, label)
    }

    /// 把内容经 `sudo tee` 写进 root 拥有的路径。
    ///
    /// 命令形式必须与远端 sudoers 白名单一致（`tee <path>`）—— `cmd/check.rs`
    /// 的 `REQUIRED_SUDO` 就是照这些形式写的。形式一变 sudo 就退回要密码，
    /// 而部署是无人值守的，那时只会失败。
    pub fn write_file_sudo(&self, path: &str, content: &[u8], label: &str) -> Result<()> {
        self.send_stdin(
            &format!("sudo tee {} > /dev/null", sh_quote(path)),
            content,
            label,
        )
    }

    /// `Some((stdout, stderr))`；dry-run 时为 `None`（没有真的执行）。
    fn exec(&self, cmd: &str) -> Result<Option<(String, String)>> {
        let Some((stdout, stderr, status)) = self.exec_raw(cmd)? else {
            return Ok(None);
        };
        if status.success() {
            return Ok(Some((stdout, stderr)));
        }
        let mut message = format!("远端命令执行失败（exit {}）：\n  {cmd}", exit_code(&status));
        // 失败原因可能走 stdout（命令里的 `2>&1`）也可能走 stderr，两处都带上，
        // 否则调用方只能看到一句"exit 1"而不知道原因。
        if !stdout.is_empty() {
            message.push_str("\n  输出: ");
            message.push_str(&indent(&stdout, "  "));
        }
        if !stderr.is_empty() {
            message.push_str("\n  stderr: ");
            message.push_str(&indent(&stderr, "  "));
        }
        Err(Error::msg(message))
    }

    /// 跑远端命令并拿到 (stdout, stderr, 退出状态)；dry-run 时为 `None`。
    fn exec_raw(&self, cmd: &str) -> Result<Option<(String, String, std::process::ExitStatus)>> {
        if self.dry_run {
            ui::dry_run(&format!("ssh {}", self.argv(cmd).join(" ")));
            return Ok(None);
        }
        let output = Command::new("ssh")
            .args(self.argv(cmd))
            .output()
            .map_err(|e| Error::io("启动 ssh（确认 PATH 里有 OpenSSH 客户端）", e))?;
        Ok(Some((
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
            output.status,
        )))
    }
}

fn exit_code(status: &std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => code.to_string(),
        None => "信号终止".to_string(),
    }
}

/// 上传收口：写入失败与远端非零退出都算失败，且给出能定位的原因。
fn finish_upload(written: Result<()>, status: std::process::ExitStatus, label: &str) -> Result<()> {
    match (written, status.success()) {
        (Ok(()), true) => Ok(()),
        (Err(e), _) => Err(Error::msg(format!(
            "上传 {label} 时写入 ssh stdin 失败：{e}\n  \
             （多半是远端命令已提前退出，看它上面打印的报错）"
        ))),
        (Ok(()), false) => Err(Error::msg(format!(
            "上传 {label} 失败：远端命令退出码 {}",
            exit_code(&status)
        ))),
    }
}

/// 把多行文本缩进，便于嵌进错误信息。
fn indent(text: &str, prefix: &str) -> String {
    text.lines()
        .collect::<Vec<_>>()
        .join(&format!("\n{prefix}"))
}

/// 把一个值安全地嵌进**远端 shell** 的单引号里。
///
/// 单引号内除 `'` 外一切字符都是字面量（包括 `$`、反引号、`\`、空格、换行），
/// 而 `'` 本身用 `'\''` 表达（收尾 → 转义的单引号 → 重新开引号）。
pub fn sh_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// 远端路径的**原始值**（未加引号）。
///
/// 要嵌进远端命令时用 `sh_quote(&path_of(…))` 包一次；要交给会自行加引号的接口
/// （`exists` / `condition`）时直接传它。
pub fn path_of(dir: &str, suffix: &str) -> String {
    format!("{dir}/{suffix}")
}

/// 拼一条远端命令里的 glob：目录走 `sh_quote`，**模式保持字面量**。
///
/// 返回值是 shell 语法，不是路径值 —— 只用于 `ls 'dir'/*.db`、`chmod 755 'dir'/*`
/// 这类地方。普通路径请用 `path_of` + `sh_quote`，否则会把已加引号的串再引一次，
/// 得到的路径里带字面引号（`exists()` 里有个 debug_assert 专门拦这个）。
pub fn glob_in(dir: &str, pattern: &str) -> String {
    format!("{}/{}", sh_quote(dir), pattern)
}

/// 列一个目录里匹配 `pattern` 的文件，返回**文件名**（basename，不含目录）。
///
/// 一致性很要紧：`ls` 给的是完整路径，而下游（保留策略要 rm、回滚要拼 stem）
/// 都按文件名工作。早先两处各自 `ls` 后又把目录前缀拼了一次，于是 rm 的目标变成
/// `'/dir'//'dir'/file` —— `rm -f` 对不存在的路径不报错，删除静默失效。
pub fn list_files(remote: &Remote, dir: &str, pattern: &str) -> Result<Vec<String>> {
    let out = remote.capture_if_run(&format!("ls -1 {} 2>/dev/null", glob_in(dir, pattern)))?;
    Ok(out
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(basename)
        .map(str::to_string)
        .collect())
}

/// 取远端路径的最后一段。
///
/// **远端路径一律用 `/` 分隔，与本机是什么系统无关** —— 所以解析远端输出时
/// 必须按 `'/'` 切，不能走 `std::path`（在 Windows 上它会按 `\` 处理，
/// 于是 `/opt/brb/data/x.db` 会被当成一整段）。
pub fn basename(path: &str) -> Option<&str> {
    path.rsplit('/').next().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_plain_value() {
        assert_eq!(sh_quote("/opt/brb/data"), "'/opt/brb/data'");
        assert_eq!(sh_quote(""), "''");
    }

    #[test]
    fn quotes_metacharacters_as_literals() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("$HOME"), "'$HOME'");
        assert_eq!(sh_quote("a|b&c"), "'a|b&c'");
        assert_eq!(sh_quote("`id`"), "'`id`'");
        assert_eq!(sh_quote("a\\b"), "'a\\b'");
    }

    #[test]
    fn escapes_single_quote() {
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }

    /// 真正过一遍 POSIX shell：证明 `sh_quote` 的转义是对的，
    /// 而不只是"看起来像对的"。（Windows 上没有 sh，跳过。）
    #[cfg(unix)]
    #[test]
    fn survives_a_real_shell_round_trip() {
        let samples = [
            "plain",
            "with space",
            "it's",
            "quote'quote'quote",
            "$VAR `cmd` ${x}",
            "a|b&c;d>e",
            "back\\slash",
            "换行\n和\t制表",
            "双引号\"与'单引号'",
        ];
        for sample in samples {
            let script = format!("printf '%s' {}", sh_quote(sample));
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(&script)
                .output()
                .expect("本机应有 sh");
            assert!(output.status.success(), "sh 拒绝了: {script}");
            assert_eq!(
                String::from_utf8_lossy(&output.stdout),
                sample,
                "往返后内容变了: {script}"
            );
        }
    }

    #[test]
    fn glob_in_keeps_pattern_literal() {
        // 目录被引起来，glob 模式保持字面量（否则 `db_*.db` 不会展开）
        assert_eq!(
            glob_in("/opt/brb/backup", "db_*.db"),
            "'/opt/brb/backup'/db_*.db"
        );
        assert_eq!(glob_in("/opt/brb/service", "*"), "'/opt/brb/service'/*");
    }

    #[test]
    fn path_of_returns_a_raw_value() {
        // 原始值：没有引号，交给 sh_quote 或 exists() 时不会再被引第二次
        assert_eq!(
            path_of("/opt/brb/service", "brainbow"),
            "/opt/brb/service/brainbow"
        );
        assert!(!path_of("/opt/brb/backup", "db_x.db").contains('\''));
    }

    #[test]
    fn basename_splits_on_remote_separator() {
        // 远端路径始终是 '/'，不受本机（可能是 Windows）影响。
        assert_eq!(
            basename("/opt/brb/backup/db_deploy_20260921_193500.db"),
            Some("db_deploy_20260921_193500.db")
        );
        assert_eq!(basename("brainbow"), Some("brainbow"));
        assert_eq!(basename(""), None);
        assert_eq!(basename("/"), None);
    }
}
