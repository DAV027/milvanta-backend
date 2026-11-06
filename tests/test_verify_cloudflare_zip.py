"""Safety and freshness regression checks for Cloudflare release packaging."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BUILD = REPO / "scripts" / "build-cloudflare-zip.py"
VERIFY = REPO / "scripts" / "verify-cloudflare-zip.py"

FILES = {
    "index.html": '<html><script src="js/subscriptionDeliveryEstimate.js"></script><script src="js/script.js"></script></html>',
    "profile.html": '<html><script src="js/subscriptionDeliveryEstimate.js"></script><script src="js/profile.js"></script></html>',
    "checkout.html": '<html><script src="js/checkout.js"></script></html>',
    "js/config.js": "const CONFIG = true;",
    "js/script.js": "const SUBSCRIPTION_DATE_ESTIMATE = true;",
    "js/profile.js": "const PROFILE_CALENDAR_ORDER_PROVENANCE = true;",
    "js/checkout.js": "const CHECKOUT_GATE = true;",
    "js/subscriptionDeliveryEstimate.js": "window.MilvantaSubscriptionSchedule = {};",
}

class CloudflareZipVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name, value in FILES.items():
            output = self.root / "frontend" / "cloudflare-upload" / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(value, encoding="utf-8")
            mirror = self.root / "frontend" / name
            mirror.parent.mkdir(parents=True, exist_ok=True)
            mirror.write_text(value, encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def run_build(self):
        return subprocess.run([sys.executable, str(BUILD)], cwd=self.root,
                              check=True, capture_output=True, text=True)

    def run_verify(self):
        return subprocess.run([sys.executable, str(VERIFY)], cwd=self.root,
                              capture_output=True, text=True)

    def test_valid_rebuild_generates_manifest_and_matching_archives(self):
        self.run_build()
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.root / "milvanta-cloudflare-upload-manifest.json").read_text())
        self.assertEqual(manifest["file_count"], len(FILES))
        self.assertEqual(len(manifest["zip_sha256"]), 64)
        self.assertEqual(
            (self.root / "milvanta-cloudflare-upload.zip").read_bytes(),
            (self.root / "frontend" / "milvanta-cloudflare-upload.zip").read_bytes()
        )

    def test_stale_archive_rejected_if_upload_file_updated_after_packaging(self):
        self.run_build()
        (self.root / "frontend" / "cloudflare-upload" / "js" / "profile.js").write_text(
            "const PROFILE_CALENDAR_ORDER_PROVENANCE = false;", encoding="utf-8")
        (self.root / "frontend" / "js" / "profile.js").write_text(
            "const PROFILE_CALENDAR_ORDER_PROVENANCE = false;", encoding="utf-8")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Stale or corrupted packaged asset", result.stderr)

    def test_source_upload_mismatch_fails_even_when_zip_is_fresh(self):
        self.run_build()
        (self.root / "frontend" / "js" / "script.js").write_text(
            "const UNDEPLOYED_CHANGE = true;", encoding="utf-8")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Frontend/upload mirror mismatch", result.stderr)

    def test_forbidden_secrets_rejected(self):
        secret = self.root / "frontend" / "cloudflare-upload" / ".env.production"
        secret.write_text("API_SECRET=example", encoding="utf-8")
        self.run_build()
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Forbidden potentially sensitive asset", result.stderr)

    def test_missing_required_helper_fails(self):
        (self.root / "frontend" / "cloudflare-upload" / "js" / "subscriptionDeliveryEstimate.js").unlink()
        self.run_build()
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing required Cloudflare files", result.stderr)

if __name__ == "__main__":
    unittest.main()
