import zipfile
import os

src_dir = os.path.abspath('frontend/cloudflare-upload')
zip_path = os.path.abspath('frontend/milvanta-cloudflare-upload.zip')

if os.path.exists(zip_path):
    os.remove(zip_path)

count = 0
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        for f in sorted(files):
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, src_dir).replace('\\', '/')
            zf.write(full_path, rel_path)
            count += 1

print(f"Packed {count} files into {zip_path}")

