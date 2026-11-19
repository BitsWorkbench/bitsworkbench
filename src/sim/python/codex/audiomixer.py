# CircuitPython's audiomixer for the simulated CodeX.
import _sim
from audiobusio import _sim_id, _silence, _still_silent


class MixerVoice:
    def __init__(self, mixer_id, n):
        self._mixer = mixer_id
        self._n = n
        self._level = 1.0
        self._playing = False
        self._silent_until = None

    def play(self, sample, *, loop=False):
        self._silent_until = _silence(sample, loop)
        self._playing = self._silent_until is None    # a silent MP3 plays until its time is up
        _sim.mixer_voice(self._mixer, self._n, _sim_id(sample), self._level)

    def stop(self):
        self._playing = False
        self._silent_until = None
        _sim.mixer_voice(self._mixer, self._n, -1, self._level)

    @property
    def playing(self):
        return self._playing or _still_silent(self._silent_until)

    @property
    def level(self):
        return self._level

    @level.setter
    def level(self, v):
        self._level = float(v)
        _sim.mixer_level(self._mixer, self._n, self._level)


class Mixer:
    def __init__(self, voice_count=2, buffer_size=1024, channel_count=2, bits_per_sample=16,
                 samples_signed=True, sample_rate=8000):
        self._id = _sim.mixer_new(voice_count)
        self.voice = tuple(MixerVoice(self._id, i) for i in range(voice_count))
        self.sample_rate = sample_rate

    @property
    def playing(self):
        return any(v.playing for v in self.voice)

    def play(self, sample, *, voice=0, loop=False):
        self.voice[voice].play(sample, loop=loop)

    def stop_voice(self, voice=0):
        self.voice[voice].stop()

    def deinit(self):
        pass
