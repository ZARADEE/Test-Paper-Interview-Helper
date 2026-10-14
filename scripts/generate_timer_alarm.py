"""Generate the short local reminder tone without an external audio dependency."""
from pathlib import Path
import math
import struct
import wave

target = Path(__file__).resolve().parents[1] / 'frontend/public/assets/timer-alarm.wav'
rate = 22050
samples = []
for index in range(rate * 3):
    t = index / rate
    phase = t % 1
    envelope = max(0.0, min(1.0, phase / .02, (.55-phase) / .15))
    value = .23 * envelope * (math.sin(2*math.pi*660*t)+.25*math.sin(2*math.pi*880*t))
    samples.append(struct.pack('<h', round(value*32767)))
with wave.open(str(target), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(rate)
    audio.writeframes(b''.join(samples))
print(target)
