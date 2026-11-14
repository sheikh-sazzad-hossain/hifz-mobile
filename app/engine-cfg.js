// Settings -> engine values (spec C3 §2.5, §2.6, §4.1, §4.6, §4.8, §4.9). Pure functions of get(id), so Node tests can use them.
const SENS = { low: { QUIET_FLOOR: 0.008, BACK_VOICE: 0.45 }, normal: { QUIET_FLOOR: 0.004, BACK_VOICE: 0.35 }, high: { QUIET_FLOOR: 0.002, BACK_VOICE: 0.25 } };
const ADV = { windowS: 'WINDOW_S', updateEveryS: 'UPDATE_EVERY_S', lookahead: 'LOOKAHEAD', shortSkip: 'SHORT_SKIP', longSkipRun: 'LONG_SKIP_RUN', finalSkip: 'FINAL_SKIP',
  detectMinWords: 'DETECT_MIN_WORDS', detectMargin: 'DETECT_MARGIN', detectSureWords: 'DETECT_SURE_WORDS', lostS: 'LOST_S', lostReds: 'LOST_REDS', lostOf: 'LOST_OF',
  rewindRun: 'REWIND_RUN', backWords: 'BACK_WORDS', verifyWindowS: 'VERIFY_WINDOW_S', verifyMaxS: 'VERIFY_MAX_S', autoExtendAt: 'AUTO_EXTEND_AT', maxClipS: 'MAX_CLIP_S' };

// the constants of core/follower.js's C (applyTuning(over)); only values that differ from the default matter but all are given
export function tuningFrom(get) {
  const o = { ...SENS[get('device.sensitivity')], SIMILAR_RATIO: get('detect.similarRatio'), CONFIRMED_WORDS: get('detect.confirmedWords'),
    AUTO_AYAHS: get('recite.autoAyahs'), CLIP_CONTEXT_WORDS: get('audio.myCtxWords') };
  for (const [id, key] of Object.entries(ADV)) o[key] = get(`adv.${id}`);
  return o;
}
export const historyOptsFrom = (get) => ({ clearStreak: get('history.clearStreak'), lookClears: get('history.lookClears'), good: get('history.good'), fair: get('history.fair'),
  gradeWindow: get('history.gradeWindow'), recent: get('history.recent'), weekDays: get('history.weekDays'), minWords: get('history.minWords'), maxEvents: get('history.maxEvents'), ctxBefore: get('audio.ctxBefore'), ctxAfter: get('audio.ctxAfter'),
  hotZones: get('history.hotZones'), stripCells: get('adv.stripCells'), cellMid: get('adv.cellMid'), cellDark: get('adv.cellDark'), peekCounts: get('peek.countsAsMistake') });
export const feedbackOptsFrom = (get) => ({ sameAudio: get('adv.sameAudio'), sameHeard: get('adv.sameHeard') });
export const followerOptsFrom = (get) => ({ changed: get('detect.changed'), skipped: get('detect.skipped'), added: get('detect.added'), stray: get('detect.stray'),
  noAdvance: get('detect.noAdvance'), silenceHelp: get('recite.silenceHelp'), promptOnLook: get('recite.promptOnLook'), teach: get('detect.teachOnRemove'),
  ctxBefore: get('audio.ctxBefore'), ctxAfter: get('audio.ctxAfter'), myCtx: get('audio.myCtxWords'), slow: get('device.slowPhone') });
export const micOptsFrom = (get) => ({ echoCancel: get('device.echoCancel'), noiseSuppress: get('device.noiseSuppress'), autoGain: get('device.autoGain'), deviceId: get('device.micId') });
