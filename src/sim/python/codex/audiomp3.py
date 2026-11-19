# CircuitPython's audiomp3 for the simulated CodeX. The files in a simulated
# CodeX's sounds/ folder are stand-ins (src/sim/kinds.js, driveFiles):
#   SIM-MP3 <seconds> <name> <1 if the simulator has its recording>
# A recorded one plays on the simulator's speaker (src/sim/sound.js); the
# rest play as silence. Either way it plays as long as it does on a CodeX, so
# a program waits as it would there. Any other MP3 counts as a second of
# silence.
import _sim

STAND_IN = b"SIM-MP3 "


class MP3Decoder:
    def __init__(self, file, buffer=None):
        self._seconds = 1.0
        try:
            head = file.read(64)
        except Exception:
            head = b""
        if isinstance(head, str):
            head = head.encode()
        if head.startswith(STAND_IN):
            words = head[len(STAND_IN):].split()
            try:
                self._seconds = float(words[0])
            except (ValueError, IndexError):
                pass
            if len(words) >= 3 and words[2] == b"1":
                self._id = _sim.clip_new(words[1].decode())
        self.sample_rate = 44100

    def deinit(self):
        pass
