import json
from pathlib import Path
import tempfile
import unittest

import keyconfig
from metrics import TapRecorder, report, csv_bytes


class BindingTests(unittest.TestCase):
    def test_eight_key_order_and_metrics(self):
        self.assertEqual(keyconfig.DEFAULTS['8k'][3:7], [68, 67, 188, 76])
        recorder = TapRecorder()
        recorder.update({67}, 1)
        recorder.update(set(), 1.05)
        recorder.update({188}, 1.1)
        recorder.update(set(), 1.16)
        data = report(recorder.snapshot(), '8k')
        self.assertEqual([r['key'] for r in data['taps']], ['C', '、'])
        self.assertEqual(data['taps'][0]['next_press_ms'], 100)
        self.assertEqual(report(recorder.snapshot(), '56k')['selected_total'], 0)
        self.assertIn('、', csv_bytes(data).decode('utf-8-sig'))

    def test_custom_auxiliary_keys_and_persistence(self):
        bindings = {k: list(v) for k, v in keyconfig.DEFAULTS.items()}
        bindings['4k'] = [81, 70, 71, 72, 74, 80]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            path.write_text(json.dumps(keyconfig.validate(bindings)))
            self.assertEqual(keyconfig.load(path), bindings)
        recorder = TapRecorder()
        recorder.update({81, 70}, 1)
        recorder.update(set(), 1.02)
        recorder.update({71}, 1.1)
        recorder.update(set(), 1.15)
        data = report(recorder.snapshot(), '4k', bindings['4k'])
        auxiliary = next(r for r in data['taps'] if r['key'] == 'Q')
        self.assertIsNone(auxiliary['next_press_ms'])
        self.assertEqual(data['summary']['hold']['count'], 2)
        self.assertEqual(data['summary']['interval']['mean_ms'], 100)

    def test_invalid_bindings(self):
        for invalid in ([160]*6, [160, 65, 83, 187, 186, 999], [65], [True, 65, 83, 187, 186, 161]):
            with self.assertRaises(ValueError):
                keyconfig.validate({**keyconfig.DEFAULTS, '4k': invalid})


if __name__ == '__main__':
    unittest.main()
