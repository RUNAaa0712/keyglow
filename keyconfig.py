"""Validated physical key bindings shared by capture and reports."""
import json

DEFAULTS = {
    '4k': [160, 65, 83, 187, 186, 161],
    '56k': [160, 65, 83, 68, 76, 187, 186, 161],
    '8k': [160, 65, 83, 68, 67, 188, 76, 187, 186, 161],
}
LABELS = {k: chr(k) for k in range(65, 91)}
LABELS.update({k: chr(k) for k in range(48, 58)})
LABELS.update({k: f'F{k-111}' for k in range(112, 124)})
LABELS.update({k: f'Num{k-96}' for k in range(96, 106)})
LABELS.update({8:'Backspace',9:'Tab',13:'Enter',27:'Esc',32:'Space',
    33:'PageUp',34:'PageDown',35:'End',36:'Home',37:'←',38:'↑',39:'→',40:'↓',
    45:'Insert',46:'Delete',160:'L_SHIFT',161:'R_SHIFT',162:'L_CTRL',163:'R_CTRL',
    164:'L_ALT',165:'R_ALT',186:':',187:';',188:'、',189:'-',190:'.',191:'/',
    192:'@',219:'[',220:'\\',221:']',222:'^',226:'ろ',106:'Num*',107:'Num+',109:'Num-',110:'Num.',111:'Num/'})

def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError('配列が不正です。')
    for layout, keys in value.items():
        if (not isinstance(keys, list) or len(keys) != len(DEFAULTS[layout]) or
                any(type(k) is not int or k not in LABELS for k in keys) or len(set(keys)) != len(keys)):
            raise ValueError('各位置に重複しないキーを選んでください。')
    return {layout: list(keys) for layout, keys in value.items()}

def load(path):
    try:
        return validate(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError):
        return {layout: list(keys) for layout, keys in DEFAULTS.items()}
