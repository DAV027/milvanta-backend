#!/usr/bin/env python3
"""Verify that the Cloudflare upload archive really contains the current frontend.

Read-only verification: this script does not deploy or modify payment/production
settings. Run after scripts/build-cloudflare-zip.py; it writes a SHA256 manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, BadZipFile

REQUIRED = {
    "index.html",
    "profile.html",
    "checkout.html",
    "js/config.js",
    "js/script.js",
    "js/profile.js",
    "js/checkout.js",
    "js/subscriptionDeliveryEstimate.js",
}
MIRRORED = {
    "index.html",
    "profile.html",
    "checkout.html",
    "js/script.js",
    "js/profile.js",
    "js/checkout.js",
    "js/subscriptionDeliveryEstimate.js",
}
FORBIDDEN_DIRS = {".git", ".github", "node_modules", "__pycache__"}
FORBIDDEN_NAMES = {"id_rsa", "id_ed25519", "credentials.json", "service-account.json"}
FORBIDDEN_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def verify(root):
    root = Path(root).resolve()
    source = root / "frontend" / "cloudflare-upload"
    frontend = root / "frontend"
    archive = root / "milvanta-cloudflare-upload.zip"
    second_archive = frontend / "milvanta-cloudflare-upload.zip"
    if not source.is_dir():
        raise ValueError("Cloudflare upload source directory missing")
    if not archive.is_file() or not second_archive.is_file():
        raise ValueError("Both output ZIP archives must be rebuilt before verification")

    expected = {}
    for file in sorted(source.rglob("*")):
        if file.is_symlink():
            raise ValueError("Symlinks are not allowed in Cloudflare upload sources")
        if not file.is_file():
            continue
        relative = file.relative_to(source).as_posix()
        parts = Path(relative).parts
        if (any(p in FORBIDDEN_DIRS or p == ".env" or p.startswith(".env.") for p in parts)
                or file.name in FORBIDDEN_NAMES
                or file.suffix.lower() in FORBIDDEN_SUFFIXES):
            raise ValueError(f"Forbidden potentially sensitive asset: {relative}")
        expected[relative] = file.read_bytes()

    if not REQUIRED.issubset(expected):
        raise ValueError(f"Missing required Cloudflare files: {sorted(REQUIRED - expected.keys())}")

    # For sensitive customer-facing paths, source files must match the upload tree.
    for name in sorted(MIRRORED):
        original = frontend / name
        if not original.is_file() or original.read_bytes() != expected[name]:
            raise ValueError(f"Frontend/upload mirror mismatch: {name}")

    if archive.read_bytes() != second_archive.read_bytes():
        raise ValueError("Root and frontend release ZIPs differ")

    try:
        with ZipFile(archive, "r") as zf:
            entries = zf.infolist()
            names = [info.filename for info in entries]
            if len(names) != len(set(names)):
                raise ValueError("Archive has duplicate filenames")
            if any(name.startswith("/") or ".." in Path(name).parts or "\\" in name
                   or name.endswith("/") for name in names):
                raise ValueError("Archive contains unsafe entry paths")
            if set(names) != set(expected):
                missing = sorted(set(expected) - set(names))
                extra = sorted(set(names) - set(expected))
                raise ValueError(f"Archive/source file set differs: missing={missing}, extra={extra}")
            for name in names:
                if zf.read(name) != expected[name]:
                    raise ValueError(f"Stale or corrupted packaged asset: {name}")
            if zf.testzip() is not None:
                raise ValueError("Corrupted ZIP entry")
    except BadZipFile as exc:
        raise ValueError("Invalid Cloudflare ZIP") from exc

    # Prevent an especially misleading deployment where the helper isn't loaded.
    for html, js in [("index.html", "js/script.js"), ("profile.html", "js/profile.js")]:
        body = expected[html].decode("utf-8")
        helper = "js/subscriptionDeliveryEstimate.js"
        if helper not in body or js not in body or body.index(helper) >= body.index(js):
            raise ValueError(f"Subscription estimate helper must load before {js} in {html}")

    archive_sha = sha256(archive.read_bytes())
    return {
        "zip_name": archive.name,
        "zip_sha256": archive_sha,
        "file_count": len(expected),
        "files_sha256": {name: sha256(data) for name, data in sorted(expected.items())},
        "verified_mirrors": sorted(MIRRORED),
        "note": "PR validation only. No Cloudflare deployment or physical delivery authorization."
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", default="milvanta-cloudflare-upload-manifest.json")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    manifest = verify(root)
    output = root / args.output
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Verified {manifest['file_count']} archived files; ZIP SHA256: {manifest['zip_sha256']}")
    print(f"Manifest: {output}")
if __name__ == "__main__":
    main()
