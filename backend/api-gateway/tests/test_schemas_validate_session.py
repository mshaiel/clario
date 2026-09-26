import unittest

from pydantic import ValidationError

from api.schemas import ValidateSessionRequest


class TestValidateSessionSchema(unittest.TestCase):
    def _base_payload(self):
        return {
            "user_id": "u_1",
            "test_id": "assess_velar_fronting_english_v1",
            "test_type": "velar_fronting",
            "overall_session_accuracy": 82,
            "validated_errors": [
                {
                    "sentence_id": "s_1",
                    "word": "cat",
                    "index_in_sentence": 0,
                    "position": "initial",
                    "error_category": "phonology",
                    "error_type": "substitution",
                    "expected_phoneme": "k",
                    "heard_phoneme": "t",
                }
            ],
        }

    def test_position_is_required(self):
        payload = self._base_payload()
        del payload["validated_errors"][0]["position"]

        with self.assertRaises(ValidationError):
            ValidateSessionRequest(**payload)

    def test_position_must_be_known_value(self):
        payload = self._base_payload()
        payload["validated_errors"][0]["position"] = "unknown"

        with self.assertRaises(ValidationError):
            ValidateSessionRequest(**payload)

    def test_valid_position_passes(self):
        payload = self._base_payload()
        req = ValidateSessionRequest(**payload)

        self.assertEqual(req.validated_errors[0].position.value, "initial")


if __name__ == "__main__":
    unittest.main()
