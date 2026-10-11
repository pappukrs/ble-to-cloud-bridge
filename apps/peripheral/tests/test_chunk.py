import pytest

from ble_chat.chunk import Reassembler, encode, payload_size_for_mtu


def test_short_message_is_one_last_chunk():
    chunks = encode("hi", 19)
    assert chunks == [b"\x80hi"]


def test_empty_message_is_one_empty_last_chunk():
    assert encode("", 19) == [b"\x80"]


def test_long_message_is_split_with_sequence_numbers():
    chunks = encode("abcdefgh", 3)
    assert chunks == [b"\x00abc", b"\x01def", b"\x82gh"]


def test_sequence_wraps_at_128():
    message = "x" * 130
    chunks = encode(message, 1)
    assert chunks[127][0] == 127
    assert chunks[128][0] == 0
    assert chunks[129][0] == 0x81  # last flag + seq 1


def test_payload_size_for_mtu():
    assert payload_size_for_mtu(23) == 19
    assert payload_size_for_mtu(517) == 513
    assert payload_size_for_mtu(4) == 1  # never below 1


def test_rejects_payload_size_zero():
    with pytest.raises(ValueError):
        encode("x", 0)


@pytest.mark.parametrize("payload_size", [1, 3, 19, 100])
@pytest.mark.parametrize("message", ["", "a", "hello world", "नमस्ते दुनिया 🙂", "x" * 500])
def test_round_trip(message, payload_size):
    r = Reassembler()
    out = [r.feed(c) for c in encode(message, payload_size)]
    assert out[:-1] == [None] * (len(out) - 1)
    assert out[-1] == message
    assert r.dropped == 0


def test_two_messages_back_to_back():
    r = Reassembler()
    chunks = encode("first", 3) + encode("second", 3)
    got = [m for m in (r.feed(c) for c in chunks) if m is not None]
    assert got == ["first", "second"]


def test_missing_chunk_drops_message_and_resyncs():
    r = Reassembler()
    chunks = encode("abcdefgh", 3)  # 3 chunks
    assert r.feed(chunks[0]) is None
    assert r.feed(chunks[2]) is None  # seq 2 arrives, seq 1 missing
    assert r.dropped == 1
    assert r.feed(b"\x80ok") == "ok"  # next message still works


def test_utf8_split_across_chunks_is_reassembled():
    r = Reassembler()
    message = "🙂🙂"  # 4 bytes each, payload 3 splits a code point
    out = None
    for c in encode(message, 3):
        out = r.feed(c) or out
    assert out == message


def test_ignores_empty_chunk():
    assert Reassembler().feed(b"") is None
