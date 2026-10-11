"""Offline tests for pinned hosted material reuse; not release acceptance."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.request
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "rt_prepare_material_consumer", ROOT / "scripts/run-private-runtime-prepare-ci.py")
CONSUMER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONSUMER)


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class ReviewedMaterialConsumerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            dir=os.environ.get("RT_TEST_TEMP_ROOT") or os.environ.get("RUNNER_TEMP"))
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.payload = b"synthetic-offline-zip-bytes"
        self.pin = {
            "repository": "hzqedison/RT-ResearchFlow", "runId": 37945573000,
            "artifactId": 11623495593, "sourceCommit": "14f6ef6cb606fc67de688437bbb16603ff1a4f18",
            "name": "runtime-reviewed-public-materials", "size": len(self.payload),
            "zipSha256": hashlib.sha256(self.payload).hexdigest(),
        }
        self.artifact = {
            "id": self.pin["artifactId"], "expired": False, "name": self.pin["name"],
            "size_in_bytes": self.pin["size"], "digest": "sha256:" + self.pin["zipSha256"],
            "workflow_run": {"id": self.pin["runId"], "repository_id": 1408465497,
                             "head_repository_id": 1408465497,
                             "head_sha": self.pin["sourceCommit"]},
        }
        self.run = {"id": self.pin["runId"], "status": "completed",
                    "conclusion": "success", "head_sha": self.pin["sourceCommit"]}

    def download(self, artifact=None, run=None, payload=None):
        values = [json.dumps(artifact or self.artifact).encode(),
                  json.dumps(run or self.run).encode(),
                  self.payload if payload is None else payload]
        requests = []

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(values.pop(0))

        with patch.dict(os.environ, {"SOURCE_VERIFICATION_TOKEN": "offline-test-token"}), \
                patch.object(CONSUMER.urllib.request, "build_opener", return_value=Opener()):
            result = CONSUMER.download_reviewed_material_archive(self.pin, self.root / "materials.zip")
        return result, requests

    def test_exact_successful_producer_and_zip_bytes(self):
        result, requests = self.download()
        self.assertEqual(Path(result).read_bytes(), self.payload)
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(request.full_url.startswith(
            "https://api.github.com/repos/hzqedison/RT-ResearchFlow/actions/") for request in requests))
        self.assertTrue(all(request.unredirected_hdrs.get("Authorization") ==
                            "Bearer offline-test-token" for request in requests))

    def test_failed_producer_is_not_accepted(self):
        run = dict(self.run, conclusion="failure")
        with self.assertRaises(ValueError):
            self.download(run=run)
        self.assertFalse((self.root / "materials.zip").exists())

    def test_different_source_is_not_accepted(self):
        run = dict(self.run, head_sha="0" * 40)
        with self.assertRaises(ValueError):
            self.download(run=run)

    def test_artifact_digest_mismatch_is_not_accepted(self):
        artifact = dict(self.artifact, digest="sha256:" + "0" * 64)
        with self.assertRaises(ValueError):
            self.download(artifact=artifact)

    def test_download_size_and_hash_are_not_inferred_from_metadata(self):
        with self.assertRaises(ValueError):
            self.download(payload=self.payload + b"unexpected")

    def test_token_does_not_follow_signed_blob_redirect(self):
        request = urllib.request.Request("https://api.github.com/repos/hzqedison/RT-ResearchFlow/actions/artifacts/1/zip")
        request.add_unredirected_header("Authorization", "Bearer offline-test-token")
        target = "https://example.blob.core.windows.net/artifact.zip?signature=synthetic"
        redirect = CONSUMER.ReviewedMaterialRedirect().redirect_request(
            request, None, 302, "Found", {}, target)
        self.assertEqual(redirect.full_url, target)
        self.assertFalse(redirect.has_header("Authorization"))

    def test_insecure_and_unrelated_redirects_are_refused(self):
        request = urllib.request.Request("https://api.github.com/repos/hzqedison/RT-ResearchFlow/actions/artifacts/1/zip")
        for target in ("http://example.blob.core.windows.net/file", "https://unrelated.example/file"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                CONSUMER.ReviewedMaterialRedirect().redirect_request(
                    request, None, 302, "Found", {}, target)

    def test_parent_hops_are_rejected_before_ancestry_walk(self):
        archive = self.root / "archive.zip"
        archive.write_bytes(self.payload)
        (self.root / "alias").mkdir()
        value = str(self.root / "alias" / ".." / "archive.zip")
        with self.assertRaises(ValueError):
            CONSUMER.validated_material_archive(value, self.root)

    def test_material_archive_stays_below_runner_temporary_root(self):
        archive = self.root / "archive.zip"
        archive.write_bytes(self.payload)
        self.assertEqual(CONSUMER.validated_material_archive(str(archive), self.root), str(archive))
        (self.root / "other").mkdir()
        with self.assertRaises(ValueError):
            CONSUMER.validated_material_archive(str(archive), self.root / "other")


if __name__ == "__main__":
    unittest.main()
