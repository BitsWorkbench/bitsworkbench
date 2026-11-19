# CircuitPython's audiobusio for the simulated CodeX: what plays on I2SOut
# is what the speaker sounds.
import _sim
import time


class I2SOut:
    def __init__(self, bit_clock, word_select, data, *, left_justified=False):
        self._source = None
        self._mp3_until = None

    def play(self, sample, *, loop=False):
        self._source = sample
        self._mp3_until = _mp3_ends(sample, loop)
        _sim.i2s_play(_sim_id(sample), 1 if loop else 0)

    def stop(self):
        self._source = None
        self._mp3_until = None
        _sim.i2s_play(-1, 0)

    @property
    def playing(self):
        if self._mp3_until is not None:    # an MP3 plays its own length, in simulated time
            if _before(self._mp3_until):
                return True
            self.stop()                    # and then the speaker is quiet
            return False
        return bool(_sim.i2s_playing())

    def pause(self):
        pass

    def resume(self):
        pass

    def deinit(self):
        self.stop()


def _sim_id(sample):
    return getattr(sample, "_id", -2)    # -2: a sound the simulator does not synthesise


def _mp3_ends(sample, loop):
    """When an MP3 (audiomp3.py) played now ends; never when looped; None if it is not one."""
    seconds = getattr(sample, "_seconds", None)
    if seconds is None:
        return None
    return float("inf") if loop else time.monotonic() + seconds


def _before(until):
    return until is not None and time.monotonic() < until
