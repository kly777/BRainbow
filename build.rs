use std::fs;
use std::path::Path;
use std::io;

fn copy_folder(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> io::Result<()> {
    let src = src.as_ref();
    let dst = dst.as_ref();

    // 创建目标目录
    match fs::create_dir_all(dst) {
        Ok(_) => {}
        Err(e) => {
            if e.kind() != io::ErrorKind::AlreadyExists {
                return Err(e);
            }
        }
    }

    // 遍历源目录
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            // 递归复制子目录
            copy_folder(&src_path, &dst_path)?;
        } else {
            // 复制文件
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

fn main() -> std::io::Result<()> {
    copy_folder("web/dist", "./dist")?;
    Ok(())
}
