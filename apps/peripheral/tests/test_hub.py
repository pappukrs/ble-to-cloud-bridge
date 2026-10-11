from ble_chat.chunk import Reassembler, encode
from ble_chat.envelope import Envelope, decode
from ble_chat.hub import ChatHub


class FakeOutbox:
    def __init__(self, subscribed=True):
        self.subscribed = subscribed
        self.chunks: list[bytes] = []

    def notify(self, data: bytes) -> bool:
        if not self.subscribed:
            return False
        self.chunks.append(data)
        return True

    def messages(self) -> list[Envelope]:
        r = Reassembler()
        out = []
        for c in self.chunks:
            text = r.feed(c)
            if text is not None:
                out.append(decode(text))
        return out


def make(subscribed=True):
    outbox = FakeOutbox(subscribed)
    lines: list[str] = []
    hub = ChatHub(notify=outbox.notify, printer=lines.append, name="laptop", hub_id="hub")
    return hub, outbox, lines


def phone_sends(hub: ChatHub, envelope: Envelope, mtu=23):
    for chunk in encode(envelope.encode(), 19):
        result = hub.on_chunk(chunk, mtu)
    return result


def test_forwards_phone_message_to_everyone_and_prints_it():
    hub, outbox, lines = make()
    e = Envelope("p1", "Asha", "hello all", 10)
    assert phone_sends(hub, e) == e
    assert outbox.messages() == [e]
    assert lines == ["Asha: hello all"]
    assert hub.forwarded == 1


def test_long_message_is_chunked_on_the_way_out():
    hub, outbox, _ = make()
    e = Envelope("p1", "Asha", "x" * 200, 10)
    phone_sends(hub, e)
    assert len(outbox.chunks) > 1
    assert outbox.messages() == [e]


def test_uses_negotiated_mtu_for_outgoing_chunks():
    hub, outbox, _ = make()
    e = Envelope("p1", "Asha", "x" * 200, 10)
    phone_sends(hub, e, mtu=517)
    assert len(outbox.chunks) == 1


def test_laptop_user_can_say_something():
    hub, outbox, lines = make()
    assert hub.say("hi phones") is True
    [msg] = outbox.messages()
    assert msg.sender == "laptop" and msg.id == "hub" and msg.text == "hi phones"
    assert lines == ["laptop: hi phones"]


def test_say_reports_when_nobody_is_subscribed():
    hub, outbox, lines = make(subscribed=False)
    assert hub.say("anyone?") is False
    assert outbox.chunks == []
    assert lines == ["nobody is connected yet, message not sent"]


def test_malformed_message_is_dropped_not_forwarded():
    hub, outbox, lines = make()
    for chunk in encode("this is not json", 19):
        hub.on_chunk(chunk, 23)
    assert outbox.chunks == []
    assert hub.rejected == 1
    assert lines[0].startswith("dropped a malformed message")
