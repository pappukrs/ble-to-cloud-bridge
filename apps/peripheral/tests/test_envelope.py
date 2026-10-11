from ble_chat.envelope import MAX_NAME_LENGTH, Envelope, decode


def test_round_trip():
    e = Envelope("abc", "Adheesh", "hello", 123)
    assert decode(e.encode()) == e


def test_wire_json_matches_typescript():
    assert Envelope("x1", "A", "hi", 5).encode() == '{"id":"x1","from":"A","text":"hi","ts":5}'


def test_decodes_typescript_output():
    assert decode('{"id":"x1","from":"A","text":"hi","ts":5}') == Envelope("x1", "A", "hi", 5)


def test_rejects_junk():
    assert decode("nope") is None
    assert decode("null") is None
    assert decode('{"from":"A","text":"x","ts":1}') is None
    assert decode('{"id":"","from":"A","text":"x","ts":1}') is None
    assert decode('{"id":"a","from":"A","text":1,"ts":1}') is None
    assert decode('{"id":"a","from":"A","text":"x","ts":"1"}') is None
    assert decode('{"id":"a","from":"A","text":"x","ts":true}') is None


def test_truncates_long_names():
    e = decode('{"id":"a","from":"%s","text":"t","ts":1}' % ("n" * 100))
    assert e is not None and len(e.sender) == MAX_NAME_LENGTH


def test_unicode_survives():
    e = Envelope("a", "नमस्ते", "🙂", 1)
    assert decode(e.encode()) == e
