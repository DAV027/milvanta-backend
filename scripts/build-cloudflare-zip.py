import zipfile
import os
import shutil

src_dir = os.path.abspath('frontend/cloudflare-upload')
zip_path_frontend = os.path.abspath('frontend/milvanta-cloudflare-upload.zip')
zip_path_root = os.path.abspath('milvanta-cloudflare-upload.zip')

for p in [zip_path_frontend, zip_path_root]:
    if os.path.exists(p):
        os.remove(p)

count = 0
with zipfile.ZipFile(zip_path_frontend, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        for f in sorted(files):
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, src_dir).replace('\\', '/')
            zf.write(full_path, rel_path)
            count += 1

shutil.copy2(zip_path_frontend, zip_path_root)
print(f"Packed {count} files into {zip_path_frontend} and {zip_path_root}")

