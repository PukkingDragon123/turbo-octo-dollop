// Audio sandbox: /sandbox/?m=audio   (automated self-test, results in console + window.__audioReport)
// 1) live: plays every one-shot in 3D, starts/tweaks/stops every loop, exercises the API (reverb presets,
//    muffle, buses, spatial voice input, voice limit) while a sample-accurate tap checks the master output
// 2) measures every cached one-shot variation (all intensity tiers): NaN, peak <= 1, loudness, duration
// 3) renders every loop offline (OfflineAudioContext, scheduler ticked via suspend) and measures it
// Keys: [space] random one-shot, [m] muzak, [t] tension, [a] backrooms ambience.
import { audio } from '../src/audio/audio.js';
import { measure } from '../src/audio/dsp.js';
import { ONESHOTS } from '../src/audio/sfx.js';

const REQ_ONE = `ui_blip ui_select ui_back ui_error ui_type ui_boot watch_beep notification radio_beep radio_static_burst button_press lever coin credits alarm buzzer elevator_ding bell_ding phone_ring camera_shutter camera_flash flashlight_click typewriter
step_carpet step_hard step_metal step_water step_concrete jump land suit_rustle breath_heavy heartbeat hurt death eat drink bandage gasp yawn snore
impact_wood impact_metal impact_plastic impact_cardboard impact_glass impact_soft impact_heavy impact_flesh break_wood break_glass break_plastic glass_shatter grab release throw_whoosh scrape_short squeak
weld_crackle spark multitool dismantle craft drill
vending_motor vending_drop water_glug dart_throw dart_hit dart_bull fish_flop bubble door_heavy_open door_creak locker_open locker_close microwave_ding toilet_flush
pull_cord generator_start generator_fail fuse_insert wire_connect bolt_turn pipe_hiss crank radio_on transmit crate_rumble ceiling_break crate_land clone_machine clone_splat exit_door_appear countdown_tick day_change collapse_rumble teleport_whoosh fall_wind
bacteria_click bacteria_screech bacteria_step bacteria_breath bacteria_growl bacteria_attack stilllife_scream stilllife_crawl stilllife_giggle rat_squeak roach_scuttle whisper fake_footsteps splash drip water_splash_big paper thunk
healthity_talk healthity_alert healthity_happy`.split(/\s+/);
const REQ_LOOP = 'hum ambience_backrooms ambience_lobby muzak generator_run weld aquarium vending_hum crt_whine fan water_flow drips radio_static heartbeat breathing wind_fall collapse bacteria_presence tension spectator fridge_hum phone_ring_loop'.split(' ');
const LOOP_PARAMS = {
  hum: { flicker: 0.6 }, ambience_backrooms: { tension: 0.6, day: 5 }, muzak: { warble: 0.3 }, generator_run: { type: 0, load: 0.6 },
  radio_static: { signal: 0.5 }, heartbeat: { rate: 110, strength: 1 }, breathing: { rate: 24, panic: 0.8 }, collapse: { intensity: 1 }, tension: { intensity: 1 },
};
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200).toFixed(1);
const lin = (d) => 10 ** (d / 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chans = (b) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

export default async function (ctx) {
  const { THREE, scene, camera } = ctx;
  const report = { errors: [], oneShots: {}, loops: {}, live: {}, api: {} };
  window.__audioReport = report;
  const fail = (m) => { report.errors.push(m); console.error('[audio-test] FAIL ' + m); };
  const t0 = performance.now();
  await audio.init();
  report.initMs = Math.round(performance.now() - t0);
  console.log(`[audio-test] init ${report.initMs}ms state=${audio.ctx.state} sr=${audio.ctx.sampleRate} hrtf=${audio.hrtf}`);
  report.chain = await audio.measureChain();
  console.log('[audio-test] master chain in->out dBFS: ' + report.chain.map((c) => `${c.in}->${c.out}`).join('  '));

  const { oneShots, loops } = audio.list();
  const miss1 = REQ_ONE.filter((n) => !oneShots.includes(n)), missL = REQ_LOOP.filter((n) => !loops.includes(n));
  if (miss1.length) fail('missing one-shots: ' + miss1.join(','));
  if (missL.length) fail('missing loops: ' + missL.join(','));
  console.log(`[audio-test] ${oneShots.length} one-shots, ${loops.length} loops (all required names present: ${!miss1.length && !missL.length})`);

  // sample-accurate tap of the master output (independent of the render frame rate)
  let livePeak = 0, nanSeen = false, clipped = 0;
  const tap = audio.ctx.createScriptProcessor(4096, 2, 2), sink = audio.ctx.createGain();
  sink.gain.value = 0;
  tap.onaudioprocess = (e) => {
    for (const d of chans(e.inputBuffer)) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a !== a) nanSeen = true; else if (a > livePeak) livePeak = a; if (a > 0.999) clipped++; }
  };
  audio.clip.connect(tap);
  tap.connect(sink).connect(audio.ctx.destination);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xff3300 }));
  scene.add(marker);
  const P = () => new THREE.Vector3((Math.random() - 0.5) * 10, 1 + Math.random(), (Math.random() - 0.5) * 10);

  const run = async () => {
    // ---------------------------------------------------------------- 1) live
    let noop = 0;
    for (const name of oneShots) {
      const pos = P();
      marker.position.copy(pos);
      const h = audio.play(name, { pos, intensity: Math.random(), length: 1.2 });
      if (!h) fail('play returned null: ' + name);
      else if (!h.duration) noop++;
      await sleep(25);
    }
    report.live.oneShots = { peak: +livePeak.toFixed(3), voices: audio.activeVoices, noop };
    if (livePeak < 0.01) fail('one-shots inaudible on master output');
    const hs = loops.map((n) => audio.loop(n, { pos: P(), volume: 0.6, ...(LOOP_PARAMS[n] || {}) }));
    await sleep(1200);
    hs.forEach((h) => { h.setParam('intensity', 0.3); h.setPosition(P()); h.setOcclusion(0.5); h.setVolume(0.4, 0.2); h.setPitch(1.05); });
    hs[loops.indexOf('generator_run')].setParam('type', 2);
    await sleep(1000);
    hs.forEach((h) => h.stop(0.3));
    await sleep(700);
    report.live.loops = { peak: +livePeak.toFixed(3), activeAfterStop: audio.loops.size };
    if (audio.loops.size !== 0) fail('loops still active after stop: ' + audio.loops.size);
    for (const pr of ['none', 'office', 'backrooms', 'small', 'large', 'pipe', 'pool']) { audio.setReverb(pr); audio.play('impact_metal', { pos: P(), intensity: 0.8 }); await sleep(120); }
    audio.setReverb('backrooms');
    audio.setMuffle(1); audio.play('alarm'); await sleep(250); audio.setMuffle(0);
    for (const b of ['master', 'sfx', 'ambient', 'music', 'voice', 'ui']) audio.setBusVolume(b, 0.9);
    const si = audio.makeSpatialInput({ pos: new THREE.Vector3(2, 1.6, 0) });
    const osc = audio.ctx.createOscillator(), og = audio.ctx.createGain();
    osc.frequency.value = 220; og.gain.value = 0.1;
    osc.connect(og).connect(si.input); osc.start();
    si.setPosition(new THREE.Vector3(-3, 1.6, 2)); si.setOcclusion(0.7);
    await sleep(300);
    osc.stop(); si.dispose();
    for (let i = 0; i < 150; i++) audio.play(['impact_wood', 'impact_metal', 'step_hard', 'bubble', 'drip', 'spark', 'coin', 'paper'][i % 8], { pos: P(), intensity: Math.random() });
    report.api.voicesAfterSpam = audio.activeVoices;
    if (audio.activeVoices > audio.maxVoices) fail('voice limit exceeded: ' + audio.activeVoices);
    audio.play('glass_shatter').stop(0.1);
    report.api.unknownIsNull = audio.play('nope_not_a_sound') === null;
    audio.hrtf = false; audio.play('coin', { pos: P() }); audio.hrtf = true;
    await sleep(1500);
    report.live.final = { peak: +livePeak.toFixed(3), clippedSamples: clipped, nan: nanSeen };
    if (nanSeen) fail('NaN on master output');
    if (livePeak > 1.0) fail('master output peak > 1: ' + livePeak);
    console.log('[audio-test] LIVE ' + JSON.stringify(report.live) + ' API ' + JSON.stringify(report.api));

    // ---------------------------------------------------------------- 2) one-shot buffers (worker-prewarmed cache)
    for (let i = 0; i < 100 && (audio._queue.length || audio._inflight?.size); i++) await sleep(100);
    const rows = [];
    for (const name of Object.keys(ONESHOTS)) {
      const R = ONESHOTS[name];
      for (const tier of R.tiers || [1]) {
        const key = R.tiers ? `${name}@${tier}` : name;
        let bufs;
        try {
          if (R.live) bufs = [audio.render(name, tier, { length: 2 })];
          else { audio.buffer(name, tier); bufs = audio.cache.get(name).tiers[audio._tier(R, tier)]; }
        } catch (e) { fail(`render ${name}: ${e.message}`); continue; }
        for (const b of bufs) {
          const m = measure(chans(b), b.sampleRate);
          if (m.nan) fail(`${key} NaN`);
          if (m.peak > 1.0) fail(`${key} peak ${m.peak}`);
          if (m.st < lin(-50)) fail(`${key} silent (${db(m.st)} dB)`);
          report.oneShots[key] = { dur: +m.dur.toFixed(2), peak: +m.peak.toFixed(2), st: +db(m.st), sr: b.sampleRate };
        }
        const o = report.oneShots[key];
        rows.push(`${key.padEnd(22)}${o.dur.toFixed(2).padStart(5)}s pk ${o.peak.toFixed(2)} ${String(o.st).padStart(6)}dB`);
      }
    }
    const lines = [];
    for (let i = 0; i < rows.length; i += 3) lines.push(rows.slice(i, i + 3).join('  |  '));
    console.log(`[audio-test] ONE-SHOTS (${rows.length} buffers; dur, peak, short-term loudness)\n` + lines.join('\n'));

    // ---------------------------------------------------------------- 3) loops offline
    const ll = [];
    for (const name of loops) {
      try {
        const b = await audio.renderLoop(name, 4, LOOP_PARAMS[name] || {}), m = measure(chans(b), b.sampleRate);
        report.loops[name] = { rms: +db(m.rms), st: +db(m.st), peak: +m.peak.toFixed(2) };
        if (m.nan) fail(`loop ${name} NaN`);
        if (m.peak > 1.0) fail(`loop ${name} peak ${m.peak}`);
        if (m.rms < lin(-60)) fail(`loop ${name} silent`);
        ll.push(`${name.padEnd(19)} rms ${db(m.rms).padStart(6)}  pk ${m.peak.toFixed(2)}`);
      } catch (e) { fail(`loop ${name}: ${e.message}`); console.error(e); }
    }
    const tz = await audio.renderLoop('tension', 1.5, { intensity: 0 }), tm = measure(chans(tz), tz.sampleRate);
    if (tm.rms > lin(-70)) fail('tension@0 not silent ' + db(tm.rms));
    const lc = [];
    for (let i = 0; i < ll.length; i += 2) lc.push(ll.slice(i, i + 2).join('   |   '));
    console.log('[audio-test] LOOPS offline 4s (dBFS)\n' + lc.join('\n') + `\ntension@0 rms ${db(tm.rms)}`);
    report.stats = { renders: audio.stats.renders, stolen: audio.stats.stolen, cacheMB: audio.memory(), worker: !!audio._worker, elapsedS: +((performance.now() - t0) / 1000).toFixed(1) };
    report.done = true;
    console.log('[audio-test] STATS ' + JSON.stringify(report.stats));
    console.log(report.errors.length ? `[audio-test] RESULT: FAIL (${report.errors.length})\n` + report.errors.join('\n') : '[audio-test] RESULT: PASS');
  };
  run().catch((e) => { fail('test crashed: ' + e.message); console.error(e); });

  let mz = null, tn = null, am = null;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') audio.play(oneShots[Math.floor(Math.random() * oneShots.length)], { pos: P() });
    if (e.key === 'm') { if (mz) { mz.stop(1); mz = null; } else mz = audio.loop('muzak', { warble: 0.2 }); }
    if (e.key === 't') { if (tn) { tn.stop(1); tn = null; } else tn = audio.loop('tension', { intensity: 0.8 }); }
    if (e.key === 'a') { if (am) { am.stop(1); am = null; } else am = audio.loop('ambience_backrooms', { tension: 0.3, day: 3 }); }
  });
  return { update(dt) { audio.setListener(camera.position, camera.quaternion); audio.update(dt); } };
}
