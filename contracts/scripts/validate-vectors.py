#!/usr/bin/env python3
"""Validate vectors against the bundled JSON schema and integer/packing bounds; no dependencies."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
schema = json.loads((root / 'vectors.schema.json').read_text())
vectors = json.loads((root.parent / 'spec/vectors.json').read_text())

def validate(value, rule, path='$'):
    if 'anyOf' in rule:
        for branch in rule['anyOf']:
            try:
                validate(value, branch, path)
                return
            except AssertionError:
                pass
        raise AssertionError(f'{path}: no matching schema branch')
    types = {'array': list, 'object': dict, 'string': str, 'integer': int, 'boolean': bool, 'null': type(None)}
    assert type(value) is types[rule['type']], f'{path}: wrong type'
    if 'enum' in rule:
        assert value in rule['enum'], path
    if isinstance(value, dict):
        assert set(rule.get('required', [])) <= value.keys(), f'{path}: missing fields'
        if rule.get('additionalProperties') is False:
            assert value.keys() <= rule['properties'].keys(), f'{path}: extra fields'
        for key, item in value.items():
            validate(item, rule['properties'][key], f'{path}.{key}')
    elif isinstance(value, list):
        assert len(value) >= rule.get('minItems', 0), path
        for i, item in enumerate(value):
            validate(item, rule['items'], f'{path}[{i}]')
    elif isinstance(value, str) and 'pattern' in rule:
        assert re.fullmatch(rule['pattern'], value), f'{path}: invalid string'
    elif type(value) is int:
        assert rule.get('minimum', value) <= value <= rule.get('maximum', value), f'{path}: out of range'

validate(vectors, schema)
for i, case in enumerate(vectors):
    x, e = case['input'], case['event']
    assert 0 <= int(x['imdAmt']) < 2**128
    assert 0 <= int(x['blockNumber']) < 2**64
    for word in ['before', 'after']:
        assert 0 <= int(case[word]['slot0']) < 2**232
        assert 0 <= int(case[word]['slot1']) < 2**152
    assert e['slot0'] == case['after']['slot0'] and e['slot1'] == case['after']['slot1']
    assert e['on'] == e['isBuy'] == x['isBuy'] and e['imdAmount'] == x['imdAmt'] and e['tick'] == x['tick']
    assert e['swapCount'] == (int(e['slot0']) >> 128) & (2**32-1)
print(f'{len(vectors)} cases validate against vectors.schema.json and canonical integer widths.')
