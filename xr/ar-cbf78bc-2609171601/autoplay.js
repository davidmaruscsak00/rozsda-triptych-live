// Automatic playback (the Auto play switch): the painting comes apart and back
// together on its own, forever. One cycle lasts CYCLE_S seconds: the painting
// opens up, drifts through a sequence of moods, gathers itself back in the
// last CLOSE_S seconds, then stands whole for HOLD_S seconds.
//
// A mood is a random value for every slider, drawn from ranges that keep the
// dust following the water and the swirl instead of scattering: Swirl never
// drops to pure hover, and a waterfall or the Judit face come as whole moods
// rather than as noise. The sliders glide from mood to mood over GLIDE_S
// seconds on a smootherstep, so nothing the particles are asked to do changes
// quickly. Moving a slider by hand switches playback off.
const CYCLE_S = 300, HOLD_S = 10;
const OPEN_S = 40, CLOSE_S = 75;                 // coming apart; gathering back
const MOOD_MIN_S = 30, MOOD_MAX_S = 50, GLIDE_S = 20;
const TAKEOVER_S = 20;                           // from wherever the sliders were when playback starts

const smoother = x => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const rnd = (a, b) => a + (b - a) * Math.random();

function drawMood() {
  const waterfall = Math.random() < 0.3;
  return {
    sep: rnd(0.45, 0.9),
    crumble: rnd(0.35, 0.95),
    swirl: rnd(0.4, 1),
    gravity: waterfall ? rnd(0.6, 1) : 0,
    form: Math.random() < 0.35 ? 1 : 0,
    light: rnd(0.35, 0.75),
    rhythm: rnd(0.3, 0.7),
  };
}

// els: { sep, crumble, swirl, gravity, form, light, rhythm } as range inputs
export function createAutoplay(els) {
  const keys = Object.keys(els);
  let startT = null, startValues = null;
  let moodFrom = null, moodTo = null, moodAt = 0, nextMoodAt = 0;
  const read = () => Object.fromEntries(keys.map(k => [k, parseFloat(els[k].value)]));

  return function step(on, t) {
    if (!on) { startT = null; return; }
    if (startT === null) {
      startT = t; startValues = read();
      moodFrom = { ...startValues }; moodTo = drawMood(); moodAt = t; nextMoodAt = t + rnd(MOOD_MIN_S, MOOD_MAX_S);
    }
    const c = (t - startT) % (CYCLE_S + HOLD_S);    // seconds into this cycle
    if (t >= nextMoodAt) {
      const g = smoother((t - moodAt) / GLIDE_S);
      moodFrom = Object.fromEntries(keys.map(k => [k, moodFrom[k] + (moodTo[k] - moodFrom[k]) * g]));
      moodTo = drawMood(); moodAt = t; nextMoodAt = t + rnd(MOOD_MIN_S, MOOD_MAX_S);
    }
    const g = smoother((t - moodAt) / GLIDE_S);
    const mood = Object.fromEntries(keys.map(k => [k, moodFrom[k] + (moodTo[k] - moodFrom[k]) * g]));

    // how far apart the painting may be: opens, holds, closes, rests whole.
    // Crumble and Gravity leave first, so the dust is home before the pieces.
    const open = smoother(c / OPEN_S);
    const closeAt = CYCLE_S - CLOSE_S;
    const apart = c >= CYCLE_S ? 0 : open * (1 - smoother((c - closeAt) / CLOSE_S));
    const dust = c >= CYCLE_S ? 0 : open * (1 - smoother((c - closeAt) / (0.5 * CLOSE_S)));
    const target = {
      ...mood,
      sep: mood.sep * apart, form: mood.form * apart,
      crumble: mood.crumble * dust, gravity: mood.gravity * dust,
    };

    const take = smoother((t - startT) / TAKEOVER_S);
    for (const k of keys) {
      const v = startValues[k] + (target[k] - startValues[k]) * take;
      els[k].value = String(v);
    }
  };
}
