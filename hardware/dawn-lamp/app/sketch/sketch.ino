// Plant the beginning (Dawn lamp): the STM32 side of the Arduino UNO Q.
//
// Kept deliberately simple: it only talks to the hardware. All decisions (mood
// picker, watering, rhythm, dawn cue, what to show) live in Python on the Linux
// side (python/dawn_core.py), which calls these functions over the Bridge:
//
//   sense()                 -> "k=12;p=0;t=21.4;h=38.2;s=2310;l=42;m=soilprobe,keys,piezo,dht22,lightsensor"
//   draw(bytes[104])        LED matrix frame, 8 rows x 13, values 0..7
//   strip(r, g, b, w)       warm light: 12 V RGB strip, kit LEDs, LED strip and/or Pixels, 0..255
//   beep(hz, ms)            Modulino Buzzer, or the piezo
//
// Every part is an option below, so the lamp can be built from whatever is at hand,
// always on the UNO Q. Modulinos on the Qwiic connector (Knob, Buzzer, Thermo,
// Distance, Pixels) are found automatically and win over the header parts.
// Everything on the headers runs at 3.3 V: power parts from the 3.3V pin, never 5V.
//
// APIs checked against Arduino's sources (Arduino_RouterBridge 0.4.4, Arduino_Modulino
// 0.7.0, Arduino_LED_Matrix in ArduinoCore-zephyr). Not yet compiled on a board.

#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>
#include <Arduino_LED_Matrix.h>
#include <Wire.h>
#include <vector>

// ---- options -------------------------------------------------------------

// Mood input (when no Modulino Knob is plugged in):
//   0 = none
//   1 = potentiometer on A1 (ends to 3.3V and GND) + pushbutton D2 to GND
//   2 = keys "+" on D2 and "-" on D8 to choose the mood, and a confirm button on D11.
//       Plain buttons go from the pin to GND; button modules (VCC, OUT, GND) get VCC on
//       3.3V and OUT on the pin. Either works: the sketch learns each button's resting
//       level at start-up (don't hold a button while it starts). Hold confirm 3 s = away.
#define MOOD_INPUT 2
#define POT_PIN A1
#define BUTTON_PIN 2
#define KEY_PLUS_PIN 2
#define KEY_MINUS_PIN 8
#define KEY_OK_PIN 11
#define POT_CLICKS 20         // how many "clicks" one full turn of the potentiometer gives

// Chime (when no Modulino Buzzer): piezo from D3 to GND. 0 = none.
#define PIEZO 1
#define PIEZO_PIN 3

// Room temperature (when no Modulino Thermo):
//   0 = none
//   1 = TMP36 on A2 (3.3V, A2, GND)
//   2 = DHT22, 3 = DHT11 on a small board (pins "-", "out", "+"), plugged straight into
//       the UNO Q's A1, A2, A3 holes: "-" in A1, "out" in A2, "+" in A3. The sketch
//       powers it from those pins (A1 low = ground, A3 high = 3.3 V); it draws ~1.5 mA.
//       Wired instead: VCC to 3.3V, GND to GND, DATA to DHT_PIN, and set the two
//       power pins to -1. Also gives humidity.
#define TEMP_SENSOR 2
#define TEMP_PIN A2
#define DHT_PIN A2
#define DHT_GND_PIN A1
#define DHT_VCC_PIN A3

// Room light:
//   0 = none (the camera can still give it)
//   1 = phototransistor: long leg to 3.3V, short leg to A3 + 10 kOhm A3 to GND
//   2 = Grove Digital Light Sensor (TSL2561, I2C) on the header I2C pins:
//       red 3.3V, black GND, white SDA, yellow SCL
#define LIGHT_SENSOR 2
#define LIGHT_PIN A3

// Soil: a capacitive sensor (VCC 3.3V, GND, AOUT to A0) needs nothing more.
// Home-made probe instead: two wires or stainless screws in the soil, one from D4,
// one to A0, plus 10 kOhm from A0 to GND. D4 is only on while reading, which slows corrosion.
#define SOIL_PIN A0
#define SOIL_DIY 1
#define SOIL_POWER_PIN 4

// Light output on D5 (red), D9 (green), D10 (blue):
//   0 = none (the LED matrix behind the window is still the lamp's light)
//   1 = Starter Kit LEDs: yellow on D5 and D9, red on D10, 220 Ohm each to GND
//   2 = 12 V RGB strip through an L293D chip (pulls R/G/B to ground: inverted PWM;
//       D7 enables the chip once the pins are set up)
//   3 = 12 V RGB strip through 3 transistors (TIP120 or IRLZ44N), one per colour
#define LIGHT_OUTPUT 3
#define OUT_R 5
#define OUT_G 9
#define OUT_B 10
#define L293D_ENABLE 7

// Addressable LED strip (WS2812B / SK6812) on D6. Off by default so the first
// build has no extra library; to use it, set to 1 and add "Adafruit NeoPixel (1.15.5)"
// to sketch.yaml. The data line needs a 5 V-level signal: either a 74AHCT125 level
// shifter, or power the strip from 5V through a diode (~4.3 V) so 3.3 V data is enough.
#define USE_STRIP 0
#define STRIP_PIN 6
#define STRIP_LEDS 24
#define STRIP_RGBW 0          // 1 = SK6812 RGBW, 0 = WS2812B RGB

#if USE_STRIP
#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel strip_leds(STRIP_LEDS, STRIP_PIN, (STRIP_RGBW ? NEO_GRBW : NEO_GRB) + NEO_KHZ800);
#endif

Arduino_LED_Matrix matrix;
ModulinoKnob knob;
ModulinoBuzzer buzzer;
ModulinoThermo thermo;
ModulinoDistance distance;   // optional: "movement" in front of the lamp
ModulinoPixels pixels;       // optional: 8 small LEDs, plug-and-play warm light

bool hasKnob = false, hasBuzzer = false, hasThermo = false, hasDistance = false, hasPixels = false;
uint8_t frame[104];

// ---- mood input ------------------------------------------------------------

int potClick = -1;

// The potentiometer turns into clicks like the Knob's, with a little dead band
// so a hand resting on it (or electrical noise) doesn't count as a turn.
int readPotClick() {
  float pos = analogRead(POT_PIN) * (float)POT_CLICKS / 4096.0f;
  if (potClick < 0 || fabsf(pos - (potClick + 0.5f)) > 0.8f) potClick = (int)pos;
  return potClick;
}

// Keys: each press of + or - is one step, like one click of a knob. The confirm
// button is read directly (press and release = confirm, hold 3 s = away).
int keyCount = 0;
bool plusDown = false, minusDown = false;
uint32_t keyChangedAt = 0;
int plusIdle = HIGH, minusIdle = HIGH, okIdle = HIGH;   // resting level, learned in setup()

bool okPressed() { return digitalRead(KEY_OK_PIN) != okIdle; }

void scanKeys() {
  bool p = digitalRead(KEY_PLUS_PIN) != plusIdle, m = digitalRead(KEY_MINUS_PIN) != minusIdle;
  if (p == plusDown && m == minusDown) return;
  if (millis() - keyChangedAt < 25) return;          // debounce
  keyChangedAt = millis();
  if (p && !plusDown) keyCount++;
  if (m && !minusDown) keyCount--;
  plusDown = p; minusDown = m;
}

// ---- DHT22 / DHT11 -----------------------------------------------------------

float dhtT = NAN, dhtH = NAN;
uint32_t dhtReadAt = 0;
int dhtStatus = -1;          // -1 not read yet, 0 ok, 1 no answer, 2 cut off mid-way, 3 checksum wrong

// Counts loop turns until the line reaches `level`; 0 = it never did. Counting turns
// instead of reading the clock keeps this working whatever the timer resolution is.
uint32_t waitCount(int level) {
  for (uint32_t n = 1; n < 20000; n++) {
    if (digitalRead(DHT_PIN) == level) return n;
  }
  return 0;
}

// One read: start pulse, then 40 bits. Each bit is ~50 us low, then high: ~27 us for a 0,
// ~70 us for a 1. A bit is a 1 when its high part is longer than its low part.
// A bad read is skipped and tried again 5 s later. It runs inside sense(): the Linux side
// is then waiting for that answer and sends nothing else, so the short interrupt pause
// can't cut a Bridge message (pausing at any other moment did).
void readDHT() {
  uint8_t d[5] = {0, 0, 0, 0, 0};
  uint32_t lows[40], highs[40];
  pinMode(DHT_PIN, OUTPUT);
  digitalWrite(DHT_PIN, LOW);
  delay(TEMP_SENSOR == 3 ? 20 : 2);
  pinMode(DHT_PIN, INPUT_PULLUP);
  noInterrupts();                         // ~5 ms; safe because this runs inside sense(), see there
  bool ok = waitCount(LOW) && waitCount(HIGH) && waitCount(LOW);
  int i = 0;
  for (; ok && i < 40; i++) {
    lows[i] = waitCount(HIGH);
    highs[i] = lows[i] ? waitCount(LOW) : 0;
    if (!lows[i] || !highs[i]) break;
  }
  interrupts();
  if (!ok) { dhtStatus = 1; return; }
  if (i < 40) { dhtStatus = 2; return; }
  for (i = 0; i < 40; i++) if (highs[i] > lows[i]) d[i / 8] |= 1 << (7 - i % 8);
  if ((uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4]) { dhtStatus = 3; return; }
  dhtStatus = 0;
  if (TEMP_SENSOR == 3) {
    dhtH = d[0]; dhtT = d[2] + d[3] / 10.0f;
  } else {
    dhtH = ((d[0] << 8) | d[1]) / 10.0f;
    dhtT = (((d[2] & 0x7F) << 8) | d[3]) / 10.0f;
    if (d[2] & 0x80) dhtT = -dhtT;
  }
}

// ---- Grove Digital Light Sensor (TSL2561) --------------------------------------

uint8_t tslAddr = 0;

bool tslWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(tslAddr);
  Wire.write(0x80 | reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

void tslBegin() {
  const uint8_t addrs[] = {0x29, 0x39, 0x49};
  for (uint8_t a : addrs) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { tslAddr = a; break; }
  }
  if (tslAddr) tslWrite(0x00, 0x03);     // power on (402 ms integration, low gain by default)
}

// Room light 0..100 on a log scale: dark bedroom ~0-10, lamp-lit room ~50, daylight 60-100.
int tslLight() {
  Wire.beginTransmission(tslAddr);
  Wire.write(0x80 | 0x20 | 0x0C);         // word read of channel 0 (visible + infrared)
  if (Wire.endTransmission() != 0) return -1;
  if (Wire.requestFrom((int)tslAddr, 2) != 2) return -1;
  uint16_t ch0 = Wire.read();
  ch0 |= (uint16_t)Wire.read() << 8;
  int v = (int)(log10f(ch0 + 1.0f) * 25.0f);
  return v > 100 ? 100 : v;
}

int readSoil() {
#if SOIL_DIY
  digitalWrite(SOIL_POWER_PIN, HIGH);
  delay(5);
  int v = analogRead(SOIL_PIN);
  digitalWrite(SOIL_POWER_PIN, LOW);
  return v;
#else
  return analogRead(SOIL_PIN);
#endif
}

// ---- Bridge functions (provide_safe: they run in loop() context, safe for I2C) ----

String sense() {
  String out;
  out.reserve(128);
  String mods = SOIL_DIY ? "soilprobe" : "soil";

  if (hasKnob) {
    out += "k="; out += knob.get(); out += ";p="; out += knob.isPressed() ? 1 : 0; out += ";";
    mods += ",knob";
  } else if (MOOD_INPUT == 1) {
    out += "k="; out += readPotClick(); out += ";p="; out += digitalRead(BUTTON_PIN) == LOW ? 1 : 0; out += ";";
    mods += ",pot";
  } else if (MOOD_INPUT == 2) {
    out += "k="; out += keyCount; out += ";p="; out += okPressed() ? 1 : 0; out += ";";
    mods += ",keys";
  }

  if (hasThermo) {
    out += "t="; out += String(thermo.getTemperature(), 1); out += ";h="; out += String(thermo.getHumidity(), 1); out += ";";
    mods += ",thermo";
  } else if (TEMP_SENSOR == 1) {
    float volts = analogRead(TEMP_PIN) * 3.3f / 4095.0f;
    out += "t="; out += String((volts - 0.5f) * 100.0f, 1); out += ";";   // TMP36: 10 mV per degree, 0.5 V at 0 degrees
    mods += ",tmp36";
  } else if (TEMP_SENSOR >= 2) {
    if (millis() - dhtReadAt > 5000) { dhtReadAt = millis(); readDHT(); }
    if (!isnan(dhtT)) { out += "t="; out += String(dhtT, 1); out += ";h="; out += String(dhtH, 1); out += ";"; }
    out += "dht="; out += dhtStatus; out += ";";            // 0 ok, 1 no answer, 2 cut off, 3 checksum
    mods += TEMP_SENSOR == 3 ? ",dht11" : ",dht22";
  }

  if (LIGHT_SENSOR == 1) {
    out += "l="; out += analogRead(LIGHT_PIN) * 100 / 4095; out += ";";
    mods += ",light";
  } else if (LIGHT_SENSOR == 2 && tslAddr) {
    int l = tslLight();
    if (l >= 0) { out += "l="; out += l; out += ";"; }
    mods += ",lightsensor";
  }

  out += "s="; out += readSoil(); out += ";";
  if (hasDistance) {
    int mm = -1;
    if (distance.available()) { float v = distance.get(); if (!isnan(v)) mm = (int)v; }
    out += "d="; out += mm; out += ";";
    mods += ",distance";
  }
  if (hasBuzzer) mods += ",buzzer"; else if (PIEZO) mods += ",piezo";
  if (hasPixels) mods += ",pixels";
  if (LIGHT_OUTPUT == 1) mods += ",kitleds";
  if (LIGHT_OUTPUT >= 2) mods += ",rgbstrip";
  if (USE_STRIP) mods += ",strip";
  out += "m="; out += mods;
  return out;
}

bool draw(std::vector<uint8_t> f) {
  size_t n = f.size() < 104 ? f.size() : 104;
  for (size_t i = 0; i < 104; i++) frame[i] = i < n ? (f[i] > 7 ? 7 : f[i]) : 0;
  matrix.draw(frame);
  return true;
}

bool strip(int r, int g, int b, int w) {
#if USE_STRIP
  for (int i = 0; i < STRIP_LEDS; i++) {
#if STRIP_RGBW
    strip_leds.setPixelColor(i, strip_leds.Color(r, g, b, w));
#else
    strip_leds.setPixelColor(i, strip_leds.Color(min(255, r + w), min(255, g + w * 3 / 4), min(255, b + w / 2)));
#endif
  }
  strip_leds.show();
#endif
#if LIGHT_OUTPUT == 1
  // Fold the warm white into the yellow LEDs; red carries the deep start of the dawn.
  int yellow = min(255, w + g), red = min(255, r + w / 3);
  analogWrite(OUT_R, yellow);
  analogWrite(OUT_G, yellow);
  analogWrite(OUT_B, red);
#elif LIGHT_OUTPUT >= 2
  // Warm white on an RGB strip: lots of red, some green, a touch of blue.
  int rr = min(255, r + w), gg = min(255, g + w * 45 / 100), bb = min(255, b + w * 12 / 100);
#if LIGHT_OUTPUT == 2
  rr = 255 - rr; gg = 255 - gg; bb = 255 - bb;     // the L293D pulls to ground: inverted
#endif
  analogWrite(OUT_R, rr);
  analogWrite(OUT_G, gg);
  analogWrite(OUT_B, bb);
#endif
  if (hasPixels) {
    // Pixels are RGB only: fold the warm white into red/green; brightness 0..100
    int pr = min(255, r + w), pg = min(255, g + w * 3 / 4), pb = min(255, b + w / 3);
    int peak = max(pr, max(pg, pb));
    for (int i = 0; i < 8; i++) {
      if (peak == 0) pixels.clear(i);
      else pixels.set(i, pr, pg, pb, (uint8_t)max(1, peak * 100 / 255));
    }
    pixels.show();
  }
  return true;
}

bool beep(int hz, int ms) {
  if (hz <= 0 || ms <= 0) return true;
  if (hasBuzzer) buzzer.tone(hz, ms);
#if PIEZO
  else tone(PIEZO_PIN, hz, ms);
#endif
  return true;
}

void setup() {
  Bridge.begin();
  Modulino.begin(Wire1);                 // the Qwiic connector is on Wire1 on the UNO Q
  hasKnob = knob.begin();
  hasBuzzer = buzzer.begin();
  hasThermo = thermo.begin();
  hasDistance = distance.begin();
  hasPixels = pixels.begin();
  analogReadResolution(12);              // 0..4095 at 3.3 V
#if MOOD_INPUT == 1
  pinMode(BUTTON_PIN, INPUT_PULLUP);
#elif MOOD_INPUT == 2
  pinMode(KEY_PLUS_PIN, INPUT_PULLUP);
  pinMode(KEY_MINUS_PIN, INPUT_PULLUP);
  pinMode(KEY_OK_PIN, INPUT_PULLUP);
  delay(20);
  plusIdle = digitalRead(KEY_PLUS_PIN); minusIdle = digitalRead(KEY_MINUS_PIN); okIdle = digitalRead(KEY_OK_PIN);
#endif
#if PIEZO
  pinMode(PIEZO_PIN, OUTPUT);
#endif
#if TEMP_SENSOR >= 2
  if (DHT_GND_PIN >= 0) { pinMode(DHT_GND_PIN, OUTPUT); digitalWrite(DHT_GND_PIN, LOW); }
  if (DHT_VCC_PIN >= 0) { pinMode(DHT_VCC_PIN, OUTPUT); digitalWrite(DHT_VCC_PIN, HIGH); }
  pinMode(DHT_PIN, INPUT_PULLUP);
  dhtReadAt = millis();                  // the DHT needs ~2 s after power-up before the first read
#endif
#if LIGHT_SENSOR == 2
  Wire.begin();                          // the header SDA/SCL pins
  tslBegin();
#endif
#if LIGHT_OUTPUT == 2
  pinMode(L293D_ENABLE, OUTPUT); digitalWrite(L293D_ENABLE, LOW);   // chip off while setting up
#endif
#if LIGHT_OUTPUT >= 1
  pinMode(OUT_R, OUTPUT); pinMode(OUT_G, OUTPUT); pinMode(OUT_B, OUTPUT);
  strip(0, 0, 0, 0);                     // all off
#endif
#if LIGHT_OUTPUT == 2
  digitalWrite(L293D_ENABLE, HIGH);
#endif
#if SOIL_DIY
  pinMode(SOIL_POWER_PIN, OUTPUT);
  digitalWrite(SOIL_POWER_PIN, LOW);
#endif
  matrix.begin();
  matrix.setGrayscaleBits(3);            // values 0..7
  matrix.clear();
#if USE_STRIP
  strip_leds.begin();
  strip_leds.clear();
  strip_leds.show();
#endif
  Bridge.provide_safe("sense", sense);
  Bridge.provide_safe("draw", draw);
  Bridge.provide_safe("strip", strip);
  Bridge.provide_safe("beep", beep);
}

void loop() {
#if MOOD_INPUT == 2
  scanKeys();
#endif
  delay(5);
}
