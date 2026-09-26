import unittest
import importlib.util
from pathlib import Path
from unittest.mock import patch

import httpx


_MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "training_service.py"
_SPEC = importlib.util.spec_from_file_location("training_service_module", _MODULE_PATH)
training_service_module = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(training_service_module)
TrainingService = training_service_module.TrainingService


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = str(self._payload)
        self.request = httpx.Request("POST", "https://example.com/tensor/update")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error",
                request=self.request,
                response=httpx.Response(self.status_code, request=self.request),
            )

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, actions):
        self._actions = actions
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, json):
        self.calls += 1
        action = self._actions[min(self.calls - 1, len(self._actions) - 1)]
        if isinstance(action, Exception):
            raise action
        return action


class TestTrainingService(unittest.IsolatedAsyncioTestCase):
    def test_translate_results_maps_known_types(self):
        events = TrainingService._to_ctm_results(
            [
                {
                    "error_type": "stutter",
                    "position": "medial",
                    "expected_phoneme": "k",
                    "word": "book",
                },
                {
                    "error_type": "block",
                    "position": "initial",
                    "preceding_phoneme": "b",
                    "word": "ball",
                },
            ]
        )

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["error_type"], "Repetition")
        self.assertEqual(events[0]["position"], "medial")
        self.assertEqual(events[1]["error_type"], "Blocks")

    async def test_update_tensor_success(self):
        tensor = [[[0.0 for _ in range(9)] for _ in range(64)] for _ in range(3)]
        fake_response = _FakeResponse(status_code=200, payload={"status": "success", "updated_tensor": tensor})

        with patch.object(training_service_module.httpx, "AsyncClient", return_value=_FakeClient([fake_response])):
            updated = await TrainingService.update_tensor(
                current_tensor=None,
                validated_errors=[
                    {
                        "error_type": "substitution",
                        "position": "initial",
                        "expected_phoneme": "k",
                        "word": "cat",
                    }
                ],
            )

        self.assertEqual(len(updated), 3)
        self.assertEqual(len(updated[0]), 64)
        self.assertEqual(len(updated[0][0]), 9)

    async def test_update_tensor_retries_request_error(self):
        tensor = [[[0.0 for _ in range(9)] for _ in range(64)] for _ in range(3)]
        req = httpx.Request("POST", "https://example.com/tensor/update")
        first_error = httpx.RequestError("network down", request=req)
        fake_response = _FakeResponse(status_code=200, payload={"status": "success", "updated_tensor": tensor})
        client = _FakeClient([first_error, fake_response])

        with patch.object(training_service_module.httpx, "AsyncClient", return_value=client):
            with patch.object(training_service_module, "TRAINING_RETRIES", 2):
                with patch.object(training_service_module.asyncio, "sleep") as sleep_mock:
                    sleep_mock.return_value = None
                    updated = await TrainingService.update_tensor(
                        current_tensor=None,
                        validated_errors=[
                            {
                                "error_type": "substitution",
                                "position": "initial",
                                "expected_phoneme": "k",
                                "word": "cat",
                            }
                        ],
                    )

        self.assertEqual(client.calls, 2)
        self.assertEqual(len(updated), 3)


if __name__ == "__main__":
    unittest.main()
