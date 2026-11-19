# CircuitPython's audiomp3 for the simulated CodeX. The simulator has no
# recorded sound: an MP3 plays as silence, for as long as it would play, so a
# program that plays one runs on as it would on a CodeX. The CodeX's own
# sounds/ files are stand-ins that give their length (src/sim/kinds.js); any
# other MP3 counts as a second.

STAND_IN = b"SIM-MP3 "


class MP3Decoder:
    def __init__(self, file, buffer=None):
        self._seconds = 1.0
        try:
            head = file.read(32)
        except Exception:
            head = b""
        if isinstance(head, str):
            head = head.encode()
        if head.startswith(STAND_IN):
            try:
                self._seconds = float(head[len(STAND_IN):].split()[0])
            except (ValueError, IndexError):
                pass
        self.sample_rate = 44100

    def deinit(self):
        pass
