#!/usr/bin/env python3
"""Validate vectors against the bundled JSON schema and integer/packing bounds; no dependencies."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
schema = json.loads((root / 'vectors.schema.json').read_text())


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

# Independent port of v4-core TickMath.getSqrtPriceAtTick and the SPEC §3.1 whale threshold (quote = currency0).
SQRT_MUL = [0xfffcb933bd6fad37aa2d162d1a594001, 0xfff97272373d413259a46990580e213a, 0xfff2e50f5f656932ef12357cf3c7fdcc,
            0xffe5caca7e10e4e61c3624eaa0941cd0, 0xffcb9843d60f6159c9db58835c926644, 0xff973b41fa98c081472e6896dfb254c0,
            0xff2ea16466c96a3843ec78b326b52861, 0xfe5dee046a99a2a811c461f1969c3053, 0xfcbe86c7900a88aedcffc83b479aa3a4,
            0xf987a7253ac413176f2b074cf7815e54, 0xf3392b0822b70005940c7a398e4b70f3, 0xe7159475a2c29b7443b29c7fa6e889d9,
            0xd097f3bdfd2022b8845ad8f792aa5825, 0xa9f746462d870fdf8a65dc1f90e061e5, 0x70d869a156d2a1b890bb3df62baf32f7,
            0x31be135f97d08fd981231505542fcfa6, 0x9aa508b5b7a84e1c677de54f3e99bc9, 0x5d6af8dedb81196699c329225ee604,
            0x2216e584f5fa1ea926041bedfe98, 0x48a170391f7dc42444e8fa2]
MAX_TICK = 887272
WHALE_C, WHALE_MIN, WHALE_MAX = 632455532033675866399, 5 * 10**15, 50 * 10**18
assert WHALE_C ** 2 <= (2 * 10**7) ** 2 * 10**27 < (WHALE_C + 1) ** 2  # C = floor(K * sqrt(SUPPLY))


def sqrt_price_at_tick(tick):
    a = abs(tick)
    assert a <= MAX_TICK
    price = SQRT_MUL[0] if a & 1 else 1 << 128
    for i in range(1, 20):
        if a >> i & 1:
            price = price * SQRT_MUL[i] >> 128
    if tick > 0:
        price = (2**256 - 1) // price
    return (price + 2**32 - 1) >> 32


def whale_wei(tick):
    tick = max(-MAX_TICK, min(MAX_TICK, tick))
    return max(WHALE_MIN, min(WHALE_MAX, WHALE_C * sqrt_price_at_tick(-tick) >> 96))


def log2_fixed(v):
    if v == 0:
        return 0
    m = v.bit_length() - 1
    return m * 16 + ((v >> (m - 4) if m >= 4 else v << (4 - m)) & 15)


assert sqrt_price_at_tick(-MAX_TICK) == 4295128739
assert sqrt_price_at_tick(MAX_TICK) == 1461446703485210103287273052203988822378723970342
assert whale_wei(193380) == 39998766246454331  # FDV 4 ETH -> ~0.04 ETH

for version, filename in [(1, 'vectors.json'), (2, 'vectors-v2.json')]:
    vectors = json.loads((root.parent / 'spec' / filename).read_text())
    validate(vectors, schema)
    for i, case in enumerate(vectors):
        x, e = case['input'], case['event']
        # v1 keeps the historical IMD field names; v2 (native ETH quote) uses quoteAmt/quoteAmount.
        amt, ev_amt = ('quoteAmt', 'quoteAmount') if version == 2 else ('imdAmt', 'imdAmount')
        assert amt in x and ev_amt in e, f'{filename}[{i}]: missing {amt}/{ev_amt}'
        assert not ({'imdAmt', 'quoteAmt'} - {amt}) & x.keys(), f'{filename}[{i}]: mixed amount fields'
        assert not ({'imdAmount', 'quoteAmount'} - {ev_amt}) & e.keys(), f'{filename}[{i}]: mixed amount fields'
        assert 0 <= int(x[amt]) < 2**128
        assert 0 <= int(x['blockNumber']) < 2**64
        for word in ['before', 'after']:
            assert 0 <= int(case[word]['slot0']) < 2**232
            assert 0 <= int(case[word]['slot1']) < 2**(192 if version == 2 else 152)
        assert e['slot0'] == case['after']['slot0'] and e['slot1'] == case['after']['slot1']
        assert e['on'] == e['isBuy'] == x['isBuy'] and e[ev_amt] == x[amt] and e['tick'] == x['tick']
        assert e['swapCount'] == (int(e['slot0']) >> 128) & (2**32-1)
        if version == 2:
            assert {'name'} <= case.keys()
            assert {'whale', 'whaleWei', 'trackComplete'} <= e.keys()
            assert e['whale'] == (e['drop'] is not None)
            assert int(e['whaleWei']) == whale_wei(x['tick']), f'{filename}[{i}]: whaleWei'
            assert e['whale'] == (int(x[amt]) >= int(e['whaleWei'])), f'{filename}[{i}]: whale vs whaleWei'
            # SPEC §3.1 sizeLogEma update with the FDV-scaled upper clamp.
            emas = [(int(case[w]['slot1']) >> 152) & 65535 for w in ('before', 'after')]
            lo, hi = log2_fixed(25 * 10**12), log2_fixed(int(e['whaleWei']))
            assert emas[1] == (emas[0] * 7 + min(hi, max(lo, log2_fixed(int(x[amt]))))) // 8, f'{filename}[{i}]: sizeLogEma'
            if not e['whale']:
                assert {'fromTrack', 'writeStep', 'promoted', 'noop'} <= e.keys()
                assert e['promoted'] == (e['track'] != e['fromTrack'] or e['writeStep'] != e['step'])
            snap = e['trackComplete']
            if snap:
                a, b = int(snap['slot0']), int(snap['slot1'])
                final0, final1 = int(e['slot0']), int(e['slot1'])
                assert a < 2**232 and b < 2**192
                assert (b >> 168) & 255 >= 16
                assert (final1 >> 168) & 255 == 0
                assert snap['swapCount'] == e['swapCount'] == (a >> 128) & (2**32-1)
                assert snap['trackNo'] == (((b >> 176) & 65535) + 1) & 65535
                assert snap['trackNo'] == (final1 >> 176) & 65535
                assert snap['patternId'] == final1 & (2**32-1)
                assert snap['root'] == (final0 >> 216) & 255
                assert int(snap['seed']) == final0 & (2**64-1)
                assert ((final0 >> 64) & (2**64-1)) == ((a >> 64) & 0x000f000f000f000f)
    print(f'{filename}: {len(vectors)} cases validate against vectors.schema.json and v{version} integer/event invariants.')
