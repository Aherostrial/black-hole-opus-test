/*
 * GLSL sources. The ray tracer integrates the same Kerr–Schild Hamiltonian as js/physics.js.
 *
 * Rays are traced backwards from the camera. Doing that in ingoing Kerr–Schild coordinates
 * would make rays inside the shadow pile up on the past horizon, so the tracer instead runs
 * forward in the time-reversed spacetime (spin -a, ingoing chart). That is the outgoing chart
 * of the real hole: its time coordinate is exactly "when did this light leave its source",
 * which gives light-travel delays for free.
 */
(function (root) {
  'use strict';

  const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = 0.5 * p + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  const NOISE = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

  // ------------------------------------------------------------------ sky bake
  // Renders one face of the background cube map: stars with blackbody colours and a
  // Milky Way band with dust lanes. Baked once, then mip-mapped, so lensed stars stay
  // anti-aliased even where the lens squeezes a whole sky patch into one pixel.
  const SKY_BAKE_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform int uFace;
uniform float uSize;
uniform sampler2D uBB;
uniform float uBBLogMin;
uniform float uBBLogRange;
${NOISE}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
vec3 faceDir(int face, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}
vec3 bb(float T) {
  float u = clamp((log(T) - uBBLogMin) / uBBLogRange, 0.0, 1.0);
  return texture(uBB, vec2(u, 0.5)).rgb;
}
// One star layer on the face's own 2D grid (3x3 neighbourhood for gaussian tails).
vec3 starLayer(vec2 px, float cell, float density, float sizePx, float gain, float seed, float band) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = id + vec2(i, j);
    float h = hash12(c + seed);
    if (h > density * (1.0 + 2.5 * band)) continue;
    vec2 pos = (c + 0.15 + 0.7 * hash22(c * 1.37 + seed)) * cell;
    float d2 = dot(px - pos, px - pos);
    float m = hash12(c * 3.1 + seed * 1.7);
    float bright = gain * (pow(m, 10.0) * 9.0 + 0.18 * m);
    float T = mix(2600.0, 16000.0, pow(hash12(c + 91.7 + seed), 1.6));
    float s = sizePx * (0.8 + 1.4 * pow(m, 6.0));
    acc += bb(T) * bright * (exp(-d2 / (2.0 * s * s)) + 0.012 * exp(-sqrt(d2) / (3.0 * s)));
  }
  return acc;
}
void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec3 dir = normalize(faceDir(uFace, st));
  vec2 c = st * 2.0 - 1.0;
  float areaComp = pow(1.0 + dot(c, c), -1.5); // keeps star density uniform on the sphere

  // Milky Way: galactic plane tilted relative to the black hole's spin axis.
  vec3 gN = normalize(vec3(0.32, -0.52, 0.79));
  vec3 gC = normalize(cross(gN, vec3(0.0, 0.0, 1.0)) + vec3(0.0, 0.0, -0.25));
  gC = normalize(gC - gN * dot(gC, gN));
  float lat = dot(dir, gN);
  float toCenter = dot(dir, gC);
  float band = exp(-pow(lat / 0.17, 2.0));
  float core = exp(-pow(lat / 0.08, 2.0));
  float bulge = exp(-(1.0 - toCenter) * 3.2) * exp(-pow(lat / 0.22, 2.0));
  float clouds = fbm(dir * 3.2 + 1.3);
  float fine = fbm(dir * 11.0 + 7.1);
  float dust = smoothstep(0.42, 0.75, fbm(dir * 6.5 + vec3(4.1, 1.2, 0.3)));
  float lane = exp(-pow((lat + 0.012 * sin(toCenter * 9.0)) / 0.035, 2.0));
  float mw = band * (0.35 + 0.9 * clouds * clouds) * (0.55 + 0.6 * fine) + 1.6 * bulge * (0.5 + 0.7 * clouds);
  mw *= 1.0 - 0.72 * dust * core - 0.6 * lane * (0.4 + 0.6 * dust);
  vec3 warm = vec3(1.0, 0.80, 0.58), cool = vec3(0.66, 0.74, 1.0);
  vec3 mwCol = mix(cool, warm, clamp(0.35 + 0.8 * bulge + 0.25 * (clouds - 0.5), 0.0, 1.0));
  vec3 col = mwCol * mw * 0.055;
  // faint emission nebulae along the band
  float neb = smoothstep(0.62, 0.9, fbm(dir * 4.7 + vec3(2.0, 8.0, 1.0))) * band;
  col += vec3(0.9, 0.25, 0.35) * neb * 0.05;
  col += vec3(0.25, 0.45, 0.9) * smoothstep(0.66, 0.92, fbm(dir * 3.9 + 11.0)) * band * 0.03;

  vec2 px = gl_FragCoord.xy;
  float res = uSize / 1024.0;
  col += starLayer(px, 5.0 * res, 0.16 * areaComp, 0.55 * res, 0.07, 3.0, band);
  col += starLayer(px, 14.0 * res, 0.22 * areaComp, 0.7 * res, 0.22, 17.0, band);
  col += starLayer(px, 60.0 * res, 0.30 * areaComp, 0.9 * res, 0.55, 41.0, band * 0.3);
  fragColor = vec4(col, 1.0);
}`;

  // --------------------------------------------------------------- ray tracer
  const TRACE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
out vec4 fragColor;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec4 uE0, uER, uEU, uEF;
uniform float uTanHalf, uAspect;
uniform vec2 uShift;    // lens shift (NDC) so the hole sits in the free part of the screen
uniform float uA;       // chart spin = -a (time-reversed spacetime)
uniform float uAPhys;   // the hole's spin a
uniform float uRH;
uniform float uTime;    // camera time in M (outgoing Kerr–Schild)
uniform float uCamZ;    // photon energy at the camera for E = 1
uniform float uRIn, uROut;
uniform float uDiskGain;
uniform float uMode;    // 0 = educational clarity, 1 = physically realistic (blends in between)
uniform float uIscoRing;
uniform sampler2D uTempLUT;
uniform sampler2D uBB;
uniform float uBBLogMin, uBBLogRange;
uniform float uDiskTempK;
uniform samplerCube uSky;
uniform float uSkyGain;
uniform float uGrid;
uniform float uShell;
uniform vec2 uShellR;
uniform float uStepK;
uniform int uMaxSteps;
uniform float uREsc;
uniform float uProbeOn;
uniform sampler2D uProbeTex;
uniform float uProbeT0, uProbeDt, uProbeN, uProbeR;
uniform float uDiskDim;
uniform int uDebug;
${NOISE}

float ksR(vec3 x) {
  float a2 = uA * uA;
  float k = dot(x, x) - a2;
  return sqrt(0.5 * (k + sqrt(k * k + 4.0 * a2 * x.z * x.z)));
}

// Hamilton's equations for a photon (E = 1) in Cartesian Kerr–Schild coordinates.
void deriv(vec3 x, vec3 p, out vec3 dx, out vec3 dp, out float dt) {
  float a = uA, a2 = a * a;
  float k = dot(x, x) - a2;
  float r2 = 0.5 * (k + sqrt(k * k + 4.0 * a2 * x.z * x.z));
  float r = sqrt(r2);
  float W = r2 * r2 + a2 * x.z * x.z;
  float f = 2.0 * r * r2 / W;
  float N = r2 + a2;
  vec3 l = vec3((r * x.x + a * x.y) / N, (r * x.y - a * x.x) / N, x.z / r);
  float S = 1.0 + dot(l, p);
  dx = p - f * S * l;
  dt = 1.0 + f * S;
  vec3 gr = vec3(x.x * r * r2, x.y * r * r2, x.z * r * N) / W;
  vec3 gf = f * ((3.0 / r - 4.0 * r * r2 / W) * gr - vec3(0.0, 0.0, 2.0 * a2 * x.z / W));
  float A = x.x * p.x + x.y * p.y;
  float B = x.y * p.x - x.x * p.y;
  float C = A / N - 2.0 * r * (r * A + a * B) / (N * N) - x.z * p.z / r2;
  vec3 gT = C * gr + vec3(r * p.x - a * p.y, r * p.y + a * p.x, 0.0) / N + vec3(0.0, 0.0, p.z / r);
  dp = 0.5 * S * S * gf + f * S * gT;
}

void rk4(inout vec3 x, inout vec3 p, inout float t, float h, vec3 k1x, vec3 k1p, float k1t) {
  vec3 k2x, k2p, k3x, k3p, k4x, k4p; float k2t, k3t, k4t;
  deriv(x + 0.5 * h * k1x, p + 0.5 * h * k1p, k2x, k2p, k2t);
  deriv(x + 0.5 * h * k2x, p + 0.5 * h * k2p, k3x, k3p, k3t);
  deriv(x + h * k3x, p + h * k3p, k4x, k4p, k4t);
  x += h / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
  p += h / 6.0 * (k1p + 2.0 * k2p + 2.0 * k3p + k4p);
  t += h / 6.0 * (k1t + 2.0 * k2t + 2.0 * k3t + k4t);
}

vec3 bb(float T) {
  float u = clamp((log(max(T, 1.0)) - uBBLogMin) / uBBLogRange, 0.0, 1.0);
  return texture(uBB, vec2(u, 0.5)).rgb;
}

vec3 eduRamp(float h) {
  vec3 c0 = vec3(0.28, 0.035, 0.06);
  vec3 c1 = vec3(0.86, 0.22, 0.07);
  vec3 c2 = vec3(1.00, 0.55, 0.18);
  vec3 c3 = vec3(1.00, 0.84, 0.56);
  vec3 c4 = vec3(1.00, 0.97, 0.90);
  h = clamp(h, 0.0, 1.0) * 4.0;
  if (h < 1.0) return mix(c0, c1, h);
  if (h < 2.0) return mix(c1, c2, h - 1.0);
  if (h < 3.0) return mix(c2, c3, h - 2.0);
  return mix(c3, c4, h - 3.0);
}

// Gas texture that orbits with the local Keplerian angular velocity. Two copies, half a
// cycle apart, cross-fade so differential rotation never shears the texture into hair.
float diskTexture(float r, float phi, float omega, float t) {
  const float P = 48.0;
  float acc = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float c = t / P + 0.5 * float(layer);
    float ph = fract(c);
    float seed = floor(c) + 13.0 * float(layer);
    float w = 1.0 - abs(2.0 * ph - 1.0);
    float ang = phi - omega * ph * P;
    vec3 q = vec3(cos(ang) * 2.2, sin(ang) * 2.2, log(r) * 7.0) + vec3(seed * 7.13, seed * 3.71, 0.0);
    float n = 0.55 * vnoise(q) + 0.3 * vnoise(q * vec3(2.1, 2.1, 2.7) + 3.1) + 0.15 * vnoise(q * vec3(4.3, 4.3, 5.1) + 7.7);
    acc += w * n;
  }
  return acc;
}

// Emission (rgb, premultiplied) and opacity of the disk where the ray pierces it.
vec4 shadeDisk(vec3 xc, float r, float tEmit, float Lz) {
  float a = uAPhys;
  float sr = sqrt(r);
  float r15 = r * sr;
  float om = 1.0 / (r15 + a);
  float ut = (r15 + a) / (pow(r, 0.75) * sqrt(max(r15 - 3.0 * sr + 2.0 * a, 1e-5)));
  // Frequency ratio received/emitted: Doppler shift, gravitational redshift and the
  // camera's own blueshift. Lz is the traced ray's conserved angular momentum.
  float g = uCamZ / (ut * (1.0 + om * Lz));
  float phi = atan(xc.y, xc.x);
  float u = clamp((r - uRIn) / (uROut - uRIn), 0.0, 1.0);
  float T = texture(uTempLUT, vec2(u, 0.5)).r;
  float tex = diskTexture(r, phi, om, tEmit);
  float dens = smoothstep(0.18, 0.85, tex);
  float outer = 1.0 - smoothstep(uROut - 0.4 * (uROut - uRIn), uROut, r);

  // Educational clarity: legible heat ramp, Doppler softened to g^3 with a gentle hue shift.
  float heat = pow(1.0 - u, 1.8);
  vec3 eduCol = eduRamp(heat + 0.45 * (g - 1.0)) * (0.16 + 1.15 * heat * heat) * pow(g, 2.2);
  eduCol *= 0.45 + 1.1 * dens;
  float eduAlpha = smoothstep(uRIn, uRIn * 1.04, r) * outer * mix(0.72, 0.98, dens);

  // Physically realistic: Novikov–Thorne temperature, colour = blackbody at the observed
  // temperature g*T, bolometric intensity boosted by g^4 (Liouville: I/nu^3 is invariant).
  float gT = g * T;
  vec3 realCol = bb(uDiskTempK * gT) * pow(gT, 4.0) * 1.3 * (0.75 + 0.5 * dens);
  float realAlpha = outer * mix(0.8, 0.99, dens) * smoothstep(uRIn, uRIn * 1.02, r);

  vec3 col = mix(eduCol, realCol, uMode) * uDiskGain * (1.0 - uDiskDim);
  float alpha = mix(eduAlpha, realAlpha, uMode);
  // ISCO marker (educational)
  col += uIscoRing * vec3(0.35, 0.85, 1.0) * 1.6 * exp(-pow((r - uRIn) / (0.035 * uRIn), 2.0)) * (1.0 - uMode);
  return vec4(col, alpha);
}

void probeState(float te, out vec4 P, out vec4 V) {
  float fi = clamp((te - uProbeT0) / uProbeDt, 0.0, uProbeN - 1.001);
  int i = int(floor(fi));
  float w = fi - float(i);
  P = mix(texelFetch(uProbeTex, ivec2(i, 0), 0), texelFetch(uProbeTex, ivec2(i + 1, 0), 0), w);
  V = mix(texelFetch(uProbeTex, ivec2(i, 1), 0), texelFetch(uProbeTex, ivec2(i + 1, 1), 0), w);
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0 - uShift;
  vec3 d = normalize(vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, 1.0));
  vec4 p4 = uE0 + d.x * uER + d.y * uEU + d.z * uEF;
  p4 /= -p4.x;
  vec3 x = uCamPos;
  vec3 p = p4.yzw;
  float t = 0.0;
  float Lz = x.x * p.y - x.y * p.x;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool escaped = false;
  vec3 escDir = vec3(0.0, 0.0, 1.0);
  vec3 dx, dp; float dtl;

  for (int i = 0; i < 2000; i++) {
    if (i >= uMaxSteps) break;
    float r = ksR(x);
    if (!(r > uRH * 1.001)) break; // captured (also catches NaN)
    deriv(x, p, dx, dp, dtl);
    if (r > uREsc && dot(x, dx) > 0.0) { escaped = true; escDir = normalize(dx); break; }
    // Step by distance travelled, not affine parameter: near the horizon the coordinate
    // speed |dx| grows, and an unscaled step would jump inside toward the ring singularity.
    float h = uStepK * r * (1.0 + 2.0 * smoothstep(10.0, 60.0, r)) / max(1.0, length(dx));
    vec3 x0 = x, p0 = p; float t0 = t;
    rk4(x, p, t, h, dx, dp, dtl);

    // Crossing the equatorial plane: refine with a partial RK4 step, then shade.
    if (x0.z * x.z < 0.0) {
      float frac = x0.z / (x0.z - x.z);
      vec3 xc = x0, pc = p0; float tc = t0;
      rk4(xc, pc, tc, h * frac, dx, dp, dtl);
      float rc = sqrt(max(dot(xc.xy, xc.xy) - uA * uA, 0.0));
      if (rc > uRIn && rc < uROut && uDebug == 0) {
        vec4 dc = shadeDisk(xc, rc, uTime - tc, Lz);
        col += trans * dc.rgb * dc.a;
        trans *= 1.0 - dc.a;
        if (trans < 0.02) break;
      }
    }

    // Photon shell: faint glow per unit path length inside the band of spherical photon orbits.
    if (uShell > 0.0) {
      float rm = 0.5 * (r + ksR(x));
      float band = smoothstep(uShellR.x - 0.12, uShellR.x, rm) * (1.0 - smoothstep(uShellR.y, uShellR.y + 0.12, rm));
      col += trans * uShell * vec3(0.30, 0.78, 1.0) * band * length(x - x0) * 0.006;
    }

    // Infalling probe: its worldline is sampled at the moment this light left it.
    if (uProbeOn > 0.5) {
      vec4 P, V;
      probeState(uTime - 0.5 * (t + t0), P, V);
      vec3 seg = x - x0;
      float s = clamp(dot(P.xyz - x0, seg) / max(dot(seg, seg), 1e-8), 0.0, 1.0);
      float dist = length(x0 + s * seg - P.xyz);
      if (dist < uProbeR * 2.6) {
        float gp = uCamZ / (V.w + dot(p, V.xyz));
        float ph = fract(P.w / 6.0) * 6.0;
        float flash = 0.35 + 3.0 * exp(-ph / 0.45);
        vec3 emit = bb(9500.0 * gp) * flash * mix(pow(gp, 2.5), pow(gp, 4.0), uMode);
        if (dist < uProbeR) {
          float limb = sqrt(1.0 - pow(dist / uProbeR, 2.0));
          col += trans * emit * (1.6 + 1.4 * limb);
          trans = 0.0;
          break;
        }
        col += trans * emit * 0.05 * exp(-pow(dist / uProbeR, 2.0));
      }
    }
  }

  vec3 sd = escDir;
  if (uDebug == 2) sd = normalize(uCamPos + 1000.0 * (d.x * normalize(uER.yzw) + d.y * normalize(uEU.yzw) + d.z * normalize(uEF.yzw)));
  vec3 sky = textureGrad(uSky, sd, dFdx(sd), dFdy(sd)).rgb * uSkyGain;
  if (uDebug == 1) { fragColor = vec4(escaped ? 0.5 + 0.5 * sd : vec3(0.0), 1.0); return; }
  if (uGrid > 0.0) {
    float lat = asin(clamp(sd.z, -1.0, 1.0));
    float lon1 = atan(sd.y, sd.x);
    float lon2 = atan(-sd.y, -sd.x);
    float k = 12.0 / 3.14159265;
    float gl = lat * k;
    float fl = fwidth(gl);
    float fo = min(fwidth(lon1 * k), fwidth(lon2 * k));
    float dl = abs(fract(gl + 0.5) - 0.5) / max(fl, 1e-4);
    float lonv = abs(sd.x) > 0.5 && sd.x < 0.0 ? lon2 : lon1;
    float dlo = abs(fract(lonv * k + 0.5) - 0.5) / max(fo, 1e-4);
    float line = max(1.0 - min(dl, 1.0), (1.0 - min(dlo, 1.0)) * smoothstep(1.0, 0.9, abs(sd.z)));
    float fade = 1.0 - smoothstep(0.08, 0.35, max(fl, fo));
    bool equator = abs(lat) < 0.5 / k;
    vec3 gc = equator ? vec3(1.0, 0.62, 0.3) : vec3(0.35, 0.62, 1.0);
    sky += uGrid * gc * line * fade * 0.28;
  }
  if (escaped) col += trans * sky;
  fragColor = vec4(col, 1.0);
}`;

  // ---------------------------------------------------------------- bloom
  const BLOOM_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uFirst;
uniform float uExposure;
vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uFirst > 0.5) {
    col *= uExposure;
    float lum = luma(col);
    float knee = uThreshold * 0.6;
    float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    float w = max(soft, lum - uThreshold) / max(lum, 1e-5);
    col *= w / (1.0 + luma(col * w) * 0.02);
  }
  fragColor = vec4(col, 1.0);
}`;

  const BLOOM_UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 s = tap(vec2(-1, -1)) + 2.0 * tap(vec2(0, -1)) + tap(vec2(1, -1))
         + 2.0 * tap(vec2(-1, 0)) + 4.0 * tap(vec2(0, 0)) + 2.0 * tap(vec2(1, 0))
         + tap(vec2(-1, 1)) + 2.0 * tap(vec2(0, 1)) + tap(vec2(1, 1));
  fragColor = vec4(s / 16.0, 1.0);
}`;

  const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure, uBloomStrength, uVignette, uGrain, uSeed;
uniform vec2 uRes;
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture(uScene, vUv).rgb * uExposure + texture(uBloom, vUv).rgb * uBloomStrength;
  c = aces(c);
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= mix(1.0, smoothstep(1.25, 0.25, length(q)), uVignette);
  c = pow(c, vec3(1.0 / 2.2));
  c += (hash(gl_FragCoord.xy + uSeed) - 0.5) * uGrain;
  fragColor = vec4(c, 1.0);
}`;

  // --------------------------------------------------------------- overlays
  // Screen-space ribbons for trajectories and guides, drawn additively after tone mapping.
  const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aPrev;
layout(location = 2) in vec3 aNext;
layout(location = 3) in float aSide;
layout(location = 4) in float aDist;
layout(location = 5) in float aT;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uHeadT;
out float vSide;
out float vDist;
out float vAge;
out vec3 vWorld;
void main() {
  vec4 c = uViewProj * vec4(aPos, 1.0);
  vec4 pr = uViewProj * vec4(aPrev, 1.0);
  vec4 nx = uViewProj * vec4(aNext, 1.0);
  vec2 half_ = uViewport * 0.5;
  vec2 sc = c.xy / c.w * half_;
  vec2 sp = pr.xy / pr.w * half_;
  vec2 sn = nx.xy / nx.w * half_;
  vec2 dir = sn - sp;
  dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir);
  vec2 nrm = vec2(-dir.y, dir.x);
  c.xy += nrm * aSide * uWidth * 0.5 / half_ * c.w;
  gl_Position = c;
  vSide = aSide;
  vDist = aDist;
  vAge = uHeadT - aT;
  vWorld = aPos;
}`;

  const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in float vSide;
in float vDist;
in float vAge;
in vec3 vWorld;
out vec4 fragColor;
uniform vec4 uColor;
uniform float uDash;
uniform float uFade;
uniform float uMinAlpha;
uniform vec3 uCamPos;
uniform float uOccR;
void main() {
  if (vAge < 0.0) discard;
  if (uDash > 0.0 && fract(vDist * uDash) > 0.55) discard;
  float e = 1.0 - abs(vSide);
  float prof = e * e * (3.0 - 2.0 * e);
  float a = uColor.a * prof;
  if (uFade > 0.0) a *= mix(uMinAlpha, 1.0, exp(-vAge / uFade));
  vec3 d = vWorld - uCamPos;
  float L = length(d);
  d /= L;
  float b = dot(uCamPos, d);
  float disc = b * b - (dot(uCamPos, uCamPos) - uOccR * uOccR);
  if (disc > 0.0) {
    float th = -b - sqrt(disc);
    if (th > 0.0 && th < L) a *= 0.16;
  }
  fragColor = vec4(uColor.rgb * a, 0.0);
}`;

  const POINT_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform float uPixelRatio;
out vec4 vColor;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vColor = aColor;
}`;

  const POINT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 5.0) + 0.9 * exp(-r2 * 40.0);
  fragColor = vec4(vColor.rgb * a * vColor.a, 0.0);
}`;

  root.BHShaders = {
    FULLSCREEN_VS,
    SKY_BAKE_FS,
    TRACE_FS,
    BLOOM_DOWN_FS,
    BLOOM_UP_FS,
    COMPOSITE_FS,
    LINE_VS,
    LINE_FS,
    POINT_VS,
    POINT_FS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
