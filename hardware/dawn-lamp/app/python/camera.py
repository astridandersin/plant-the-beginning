"""
The kit's USB camera as a light and movement sensor. Runs on the UNO Q's Linux side.

Privacy by design: every few seconds it grabs ONE small grey frame, turns it into
two numbers (room brightness 0-100 and a movement score 0-100 against the previous
frame), and throws the frame away. No image is ever stored, sent or shown. Only the
two numbers go to the brain (dawn_core.Brain), and only 10-minute averages leave
the lamp.

Optional: if OpenCV or the camera isn't there, read() returns (None, None) and the
lamp works without it. Turn it on with "camera": true in config.json, and add
opencv-python-headless to python/requirements.txt.
"""
from __future__ import annotations

import time

try:
    import cv2  # type: ignore
except Exception:      # not installed: the camera is simply off
    cv2 = None


class LightMotionCamera:
    def __init__(self, index: int = 0, every_s: float = 5.0, size: tuple[int, int] = (64, 48)):
        self.index, self.every_s, self.size = index, every_s, size
        self.cap = None
        self.prev = None
        self.last_t = 0.0
        self.last = (None, None)
        self.failed_until = 0.0
        self.available = cv2 is not None

    def _open(self) -> bool:
        if cv2 is None:
            return False
        if self.cap is None or not self.cap.isOpened():
            self.cap = cv2.VideoCapture(self.index)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
        return bool(self.cap and self.cap.isOpened())

    def read(self) -> tuple[float | None, float | None]:
        """(brightness 0-100, movement 0-100), at most every `every_s` seconds; otherwise the last values."""
        now = time.monotonic()
        if now - self.last_t < self.every_s or now < self.failed_until:
            return self.last
        self.last_t = now
        if not self._open():
            self.failed_until = now + 60
            self.last = (None, None)
            return self.last
        ok, frame = self.cap.read()
        if not ok or frame is None:
            self.failed_until = now + 30
            self.last = (None, None)
            return self.last
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), self.size, interpolation=cv2.INTER_AREA)
        del frame                                         # the full frame is gone here
        small = cv2.GaussianBlur(small, (5, 5), 0)
        brightness = float(small.mean()) / 255 * 100
        motion = None
        if self.prev is not None:
            diff = cv2.absdiff(small, self.prev)
            moving = float((diff > 25).mean()) * 100      # % of the tiny image that changed
            # ignore whole-room brightness jumps (lights switched on): those change everything at once
            motion = 0.0 if moving > 60 else moving
        self.prev = small                                  # only a 64x48 blurred grey thumbnail, kept for one step
        self.last = (round(brightness, 1), None if motion is None else round(motion, 1))
        return self.last

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()
