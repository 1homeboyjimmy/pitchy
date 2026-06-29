import unittest
from subscription_service import calculate_price, normalize_config


class SubscriptionPricingTests(unittest.TestCase):
    def test_base_price(self):
        self.assertEqual(calculate_price(None), 2490)

    def test_custom_price(self):
        self.assertEqual(calculate_price({
            "messages": 70, "roadmaps": 4, "custdev": 3, "grants": 2,
        }), 5530)

    def test_message_step_is_ten(self):
        with self.assertRaises(ValueError):
            normalize_config({"messages": 51})
if __name__ == "__main__":
    unittest.main()
