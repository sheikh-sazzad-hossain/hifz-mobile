// Builds data/settings-schema.json and data/ui-strings.json from the compact tables below (spec C3 §3-§9).
//   node tools/make_data.mjs
// The JSON files are the single source of Bengali labels (shared with the laptop app).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (p) => fileURLToPath(new URL(`../data/${p}`, import.meta.url));

export const GROUPS = [
  ['recite', 'তিলাওয়াত ও ভুল ধরা', 'পড়ার সময় অ্যাপ কী ধরবে, আটকে গেলে কী করবে', 'book'],
  ['hide', 'লুকানো ও উঁকি', 'মুখস্থ পড়ার সময় লেখা কীভাবে লুকাবে, উঁকি দিলে কী হবে', 'eyeOff'],
  ['test', 'টেস্ট', 'ফ্ল্যাশ-কার্ড টেস্টের দৈর্ঘ্য, হিন্ট, স্কোর', 'card'],
  ['listen', 'শোনা ও অডিও', 'আলাফাসির তিলাওয়াত — গতি, পুনরাবৃত্তি, অফলাইন', 'speaker'],
  ['goals', 'লক্ষ্য ও স্ট্রিক', 'দিনের হিসাব, স্ট্রিক, কোন পড়া লক্ষ্যে গোনা হবে', 'flag'],
  ['history', 'অগ্রগতি ও ইতিহাস', 'দাগ মোছার নিয়ম, অবস্থার মাপকাঠি, রেকর্ডিং', 'chart'],
  ['view', 'দেখতে কেমন', 'রং, লেখার আকার, নড়াচড়া', 'palette'],
  ['device', 'মাইক ও যন্ত্র', 'মাইক, প্রসেসর, স্ক্রিন', 'mic'],
  ['adv', 'উন্নত', 'ভেতরের হিসাবের মান — সাবধানে বদলাও', 'sliders'],
];

// ---- helpers -------------------------------------------------------------------------------------------------
const rows = [];
let G = 'recite';
let SUB = '';
const grp = (g) => { G = g; SUB = ''; };
const sub = (s) => { SUB = s; };
const add = (id, label, control, def, o = {}) => rows.push({ id, group: G, sub: SUB || undefined, label, control, default: def, plat: 'both', when: 'now', ...o });
const tog = (id, label, def, help, o = {}) => add(id, label, 'tog', def, { help, ...o });
const opts = (list) => list.map((x) => (Array.isArray(x) ? { v: x[0], label: x[1] } : { v: x }));
const seg = (id, label, def, list, help, o = {}) => add(id, label, 'seg', def, { help, options: opts(list), ...o });
const chips = (id, label, def, list, custom, help, o = {}) => add(id, label, 'chips', def, { help, options: opts(list), custom, ...o });
const sld = (id, label, def, min, max, step, unit, help, o = {}) => add(id, label, 'sld', def, { help, range: { min, max, step }, unit, ...o });

// ---- 1 recite ------------------------------------------------------------------------------------------------
grp('recite'); sub('আটকে গেলে');
chips('recite.waitS', 'থামলে আলাফাসি পড়া শুরু করবেন', 2, [[0, 'বন্ধ'], 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10], { min: 0.5, max: 20, step: 0.5 }, 'কত সেকেন্ড চুপ থাকলে সাহায্য শুরু হবে; ‘বন্ধ’ = কখনো না', { unit: 's' });
chips('recite.silenceHelp', 'চুপ থাকলে কী হবে', 'surah', [['surah', 'সূরার শেষ পর্যন্ত আলাফাসি পড়বেন'], ['ayah', 'আয়াতের শেষ পর্যন্ত'], ['words3', 'পরের ৩টা শব্দ'], ['word', 'শুধু পরের শব্দ'], ['show', 'না শুনিয়ে শুধু পরের শব্দ দেখাও']], null, 'আটকে গেলে অ্যাপ কতটুকু সাহায্য করবে');
tog('recite.promptOnLook', 'দেখে পড়ার সময়ও সাহায্য করো', false, 'চোখ-বাটন চালু থাকলেও চুপ থাকলে সাহায্য আসবে');
sub('কোন ভুল ধরবে');
tog('detect.changed', 'ভুল শব্দ ধরো', true, 'একটা শব্দের জায়গায় অন্য শব্দ পড়লে লাল হবে', { when: 'next' });
tog('detect.skipped', 'বাদ পড়া শব্দ ধরো', true, 'কোনো শব্দ না পড়ে এগিয়ে গেলে লাল হবে', { when: 'next' });
tog('detect.added', 'বাড়তি শব্দ ধরো', true, 'আয়াতের মাঝে বাড়তি কিছু পড়লে পরের শব্দ লাল হবে; বন্ধ রাখলে ফোনের কাজ কমে', { when: 'next' });
tog('detect.stray', 'অন্য সূরায় চলে গেলে সতর্ক করো', true, 'মিল আছে এমন অন্য সূরার আয়াতে ঢুকে পড়লে লাল ব্যানার আর সতর্ক-শব্দ', { when: 'next' });
sld('detect.confirmedWords', 'কত শব্দ ঠিক পড়ার পর অন্য সূরা ভুল', 15, 5, 40, 1, 'words', 'কম = তাড়াতাড়ি সতর্ক; বেশি = নতুন সূরা শুরু করলে ভুল সতর্ক কম', { when: 'next' });
sld('detect.similarRatio', 'শব্দ মেলানোর কড়াকড়ি', 0.7, 0.5, 0.9, 0.05, 'pct', 'বেশি = কাছাকাছি উচ্চারণও ভুল ধরবে; কম = ছাড় বেশি', { when: 'next', scale: 100 });
tog('detect.noAdvance', 'ভুল ঠিক না করে এগোবে না', false, 'কোনো শব্দ লাল হলে সেটা ঠিক করে না পড়া পর্যন্ত পরের শব্দ খুলবে না', { when: 'next' });
tog('detect.teachOnRemove', 'ভুল বাদ দিলে মনে রাখো', true, '‘আমি সঠিকই পড়েছি’ বা ‘বাদ দাও’ চাপলে পরে একইভাবে পড়লে আর ভুল ধরবে না');
sub('সতর্ক-শব্দ');
seg('detect.errorTone', 'সতর্ক-শব্দ', 'normal', [['off', 'বন্ধ'], ['soft', 'নরম'], ['normal', 'স্বাভাবিক'], ['loud', 'জোরে']], 'লাল শব্দ বা অন্য সূরায় ঢুকলে শব্দ হবে (শুধু রেকর্ডিংয়ের সময়)');
seg('detect.toneKind', 'সতর্ক-শব্দের ধরন', 'two', [['two', 'দুই সুর'], ['beep', 'একটা বিপ'], ['double', 'দুটো বিপ']]);
tog('detect.vibrate', 'ভুলে কাঁপুনি', false, 'লাল শব্দে ফোন একটু কাঁপবে', { plat: 'M' });
sub('শুরু');
seg('recite.startAt', 'শুরুতে কোন সূরা', 'auto', [['auto', 'শুনে নিজে চিনবে'], ['last', 'আগের বারের সূরা ও আয়াত'], ['continue', 'আগের বার যেখানে থেমেছিলে তার পর থেকে']], 'অ্যাপ খুললে সূরা বাছাই কেমন থাকবে', { when: 'reload' });
sld('recite.autoAyahs', 'সামনে কত আয়াত দেখাবে', 10, 3, 30, 1, 'ayah', 'পড়তে পড়তে একবারে কত আয়াত যোগ হবে', { when: 'next' });
tog('recite.mistakeList', 'ভুলের তালিকা দেখাও', true, 'ওপরের ‘ভুল/বাদ’ গোনায় চাপলে এই সেশনের সব ভুল একসাথে');

// ---- 2 hide --------------------------------------------------------------------------------------------------
grp('hide'); sub('লুকানো লেখা');
tog('recite.look', 'দেখে পড়া (পুরো লেখা দেখাও)', false, 'চোখ-বাটনের মতো; দেখে পড়া শব্দ দাগ মোছায় গোনা হয় না');
seg('hide.style', 'লুকানো শব্দ কেমন দেখাবে', 'bar', [['bar', 'শব্দের মাপে ঘর'], ['line', 'শুধু নিচে দাগ'], ['blank', 'একদম ফাঁকা']]);
tog('hide.weakTint', 'লুকানো শব্দে আগের দুর্বলতার রং', true, 'আগের সেশনে ভুল হওয়া শব্দের ঘর হালকা থেকে গাঢ় লাল দেখাবে');
tog('hide.ayahMarks', 'আয়াত-চিহ্ন লুকাও', false, 'যে আয়াত এখনো পুরো পড়া হয়নি তার শেষের চিহ্ন দেখাবে না');
tog('hide.nextWord', 'পরের শব্দের ঘর চিহ্নিত করো', true, 'এখন যে শব্দ পড়ার কথা তার ঘরে রিং');
tog('hide.head', 'ওপরে সূরা ও আয়াত নম্বর দেখাও', true, 'বন্ধ করলে কোন আয়াতে আছ তা লুকানো থাকবে');
sub('উঁকি');
tog('peek.countsAsMistake', 'উঁকি দেওয়া ভুল হিসেবে ধরো', true, 'ইঙ্গিত বা উঁকিতে খোলা শব্দ দুর্বল দাগে আর টেস্টের স্কোরে ভুল গোনা হবে', { when: 'next' });
tog('peek.longPressRest', 'ইঙ্গিত চেপে ধরলে আয়াতের বাকিটা', true, 'ইঙ্গিত-বাটন আধা সেকেন্ড চেপে ধরলে (কম্পিউটারে ডান-ক্লিক) আয়াতের বাকি সব শব্দ খুলবে');
tog('peek.doubleTap', 'লেখায় দুবার ছুঁলে পরের শব্দ', false, 'রেকর্ডিংয়ের সময় লেখার ঘরে দুবার ছুঁলে (কম্পিউটারে ডাবল-ক্লিক) ইঙ্গিতের মতো পরের শব্দ খুলবে');

// ---- 3 test --------------------------------------------------------------------------------------------------
grp('test'); sub('দৈর্ঘ্য');
seg('test.endBy', 'টেস্ট কখন শেষ হবে', 'count', [['count', 'প্রশ্ন গুনে'], ['time', 'সময় ধরে'], ['open', 'নিজে থামালে']], undefined, { when: 'next' });
chips('test.questions', 'কতটা প্রশ্ন', 10, [10, 15, 20], { min: 1, max: 99, step: 1 }, undefined, { when: 'next', showIf: { id: 'test.endBy', eq: 'count' }, unit: 'n' });
chips('test.minutes', 'কত মিনিট', 10, [5, 10, 15], { min: 1, max: 60, step: 1 }, 'সময় শেষ হলে চলতি প্রশ্নটা শেষ করে ফল দেখাবে', { when: 'next', showIf: { id: 'test.endBy', eq: 'time' }, unit: 'min' });
sub('প্রশ্ন');
seg('test.lengthUnit', 'প্রশ্নের দৈর্ঘ্য মাপো', 'words', [['words', 'শব্দে'], ['ayahs', 'আয়াতে']], undefined, { when: 'next' });
chips('test.lengthWords', 'প্রতি প্রশ্নে কত শব্দ পড়তে হবে', 15, [[8, 'ছোট ৮'], [15, 'মাঝারি ১৫'], [30, 'লম্বা ৩০']], { min: 3, max: 80, step: 1 }, 'হিন্টের পরের শব্দ', { when: 'next', showIf: { id: 'test.lengthUnit', eq: 'words' }, unit: 'words' });
sld('test.lengthAyahs', 'প্রতি প্রশ্নে কত আয়াত', 1, 1, 10, 1, 'ayah', undefined, { when: 'next', showIf: { id: 'test.lengthUnit', eq: 'ayahs' } });
tog('test.extendToAyahEnd', 'আয়াতের শেষ পর্যন্ত টানো', true, 'প্রশ্ন আয়াতের মাঝে না থেমে আয়াত শেষ করে থামবে', { when: 'next', showIf: { id: 'test.lengthUnit', eq: 'words' } });
sld('test.hintWords', 'শুরুতে কত শব্দ দেখাবে', 3, 0, 10, 1, 'words', 'এগুলো দেখে বাকিটা না দেখে পড়বে; ০ = শুধু সূরা ও আয়াত নম্বর', { when: 'next' });
seg('test.start', 'প্রশ্ন কোথা থেকে শুরু', 'ayah', [['ayah', 'আয়াতের শুরু থেকে'], ['random', 'আয়াতের যেকোনো জায়গা থেকে']], undefined, { when: 'next' });
seg('test.order', 'প্রশ্নের ক্রম', 'shuffle', [['shuffle', 'এলোমেলো'], ['seq', 'ক্রমানুসারে'], ['weak', 'দুর্বল জায়গা আগে']], undefined, { when: 'next' });
tog('test.noRepeat', 'পুরো পরিসর শেষ না হলে প্রশ্ন আবার আসবে না', true, undefined, { when: 'next' });
tog('test.showRef', 'সূরা ও আয়াত নম্বর দেখাও', true, 'কার্ডের চোখ-বাটনেও বদলানো যায়');
sub('আটকে গেলে');
seg('test.silence', 'চুপ থাকলে', 'none', [['none', 'কিছু না'], ['show', 'পরের শব্দ দেখাও'], ['alafasy', 'আলাফাসি পরের শব্দ শোনাবেন']]);
sld('test.silenceS', 'কত সেকেন্ড চুপ থাকলে', 4, 2, 15, 0.5, 's', undefined, { showIf: { id: 'test.silence', ne: 'none' } });
tog('test.doubleTapPeek', 'কার্ডে দুবার ছুঁলে পরের শব্দ', true, 'কম্পিউটারে ডাবল-ক্লিক');
sub('স্কোর');
tog('test.skipCounts', 'ছেড়ে যাওয়া প্রশ্ন স্কোরে ধরো', true, 'ধরলে ছেড়ে যাওয়া প্রশ্ন ‘ঠিক হয়নি’ গোনা হবে');
sld('test.streakAt', 'টানা কতটা ঠিক হলে আগুন-চিহ্ন', 3, 2, 10, 1, 'n');
sub('চলার ধরন');
seg('test.advance', 'প্রশ্ন শেষে', 'auto', [['auto', 'ফল দেখিয়ে নিজে পরেরটা'], ['tap', '‘পরের প্রশ্ন’ চাপলে']]);
sld('test.holdS', 'ফল কতক্ষণ দেখাবে', 1.2, 0.5, 3.0, 0.1, 's', 'কার্ড সবুজ/লাল হওয়ার পর পরের প্রশ্নের আগে', { showIf: { id: 'test.advance', eq: 'auto' } });
seg('test.countdown', 'শুরুর আগে গোনা', 3, [[0, 'বন্ধ'], [3, '৩ সেকেন্ড'], [5, '৫ সেকেন্ড']], undefined, { when: 'next' });
seg('test.autoPauseS', 'চুপ থাকলে নিজে বিরতি', 30, [[0, 'বন্ধ'], [15, '১৫'], [30, '৩০'], [60, '৬০'], [120, '১২০ সেকেন্ড']], 'এত সেকেন্ড কিছু না পড়লে টেস্ট বিরতিতে যাবে');
tog('test.sound', 'প্রশ্ন শেষে শব্দ', true, 'ঠিক হলে উঁচু সুর, ভুল হলে নিচু সুর');
tog('test.vibrate', 'প্রশ্ন শেষে কাঁপুনি', true, undefined, { plat: 'M' });
sub('জমা');
tog('test.temporary', 'অস্থায়ী টেস্ট', false, 'কিছুই জমা হবে না — ফল, ভুল, রেকর্ডিং কিছুই না; অন্যকে শোনাতে কাজে লাগে', { when: 'next' });
tog('test.countInHistory', 'টেস্টের ভুল দুর্বল দাগে যোগ করো', true, 'বন্ধ করলে টেস্টের ফল জমা থাকবে, কিন্তু দুর্বল দাগ বদলাবে না', { when: 'next' });
tog('test.checkAdded', 'টেস্টে বাড়তি শব্দ ধরো', true, 'বন্ধ রাখলে প্রশ্ন শেষে যাচাই দ্রুত হয়', { when: 'next' });

// ---- 4 listen ------------------------------------------------------------------------------------------------
grp('listen'); sub('ক্বারি');
add('listen.reciter', 'ক্বারি: মিশারি রাশিদ আলাফাসি (এখন একজনই আছেন)', 'info', null, { when: 'now' });
sub('গতি ও পুনরাবৃত্তি');
chips('listen.speed', 'গতি', 1.0, [[0.5, '০.৫×'], [0.75, '০.৭৫×'], [1, '১×'], [1.25, '১.২৫×'], [1.5, '১.৫×'], [2, '২×']], { min: 0.5, max: 2.0, step: 0.05 }, 'ধীরে শুনলে মুখস্থ সহজ', { unit: 'x' });
chips('listen.repeatAyah', 'প্রতিটা আয়াত কতবার', 1, [1, 3, 5, 10], { min: 1, max: 50, step: 1 }, undefined, { unit: 'n' });
chips('listen.repeatRange', 'পুরো অংশ কতবার', 1, [1, 2, 3, 5, [0, 'অবিরাম']], { min: 1, max: 50, step: 1 }, undefined, { unit: 'n' });
sld('listen.gapRepeatS', 'একই আয়াত আবার শুরুর আগে বিরতি', 0, 0, 15, 0.5, 's', 'নিজে বলে দেখার সময়');
sld('listen.gapAyahS', 'প্রতি আয়াতের পরে বিরতি', 0, 0, 15, 0.5, 's', 'পরের আয়াতে যাওয়ার আগে');
tog('listen.gapAuto', 'বিরতি আয়াতের দৈর্ঘ্যের সমান', false, 'চালু করলে প্রতি আয়াতের পরে ততক্ষণ থামবে যতক্ষণ আয়াতটা পড়তে লাগে — শুনে নিজে বলার জন্য');
sub('লেখা');
seg('listen.highlight', 'কোনটা পড়া হচ্ছে দেখাও', 'word', [['word', 'শব্দ ধরে'], ['ayah', 'আয়াত ধরে'], ['none', 'কিছু না']]);
seg('listen.text', 'লেখা', 'show', [['show', 'সব দেখাও'], ['reveal', 'শুনতে শুনতে খুলবে'], ['hide', 'লুকানো']]);
tog('listen.autoScroll', 'সাথে সাথে স্ক্রল', true);
tog('listen.basmala', 'সূরার শুরুতে বিসমিল্লাহ', true, 'আয়াত ১ থেকে শুনলে আগে বিসমিল্লাহ শোনাবে (সূরা ফাতিহা ও তাওবা ছাড়া)');
tog('listen.nextSurah', 'সূরা শেষে পরের সূরা চালাও', false);
seg('listen.sleepMin', 'ঘুমের টাইমার', 0, [[0, 'বন্ধ'], [10, '১০'], [15, '১৫'], [30, '৩০'], [60, '৬০ মিনিট']], 'এত মিনিট পরে শোনা থামবে');
tog('listen.countAsSession', 'শোনা ইতিহাসে রাখো', true, 'কতক্ষণ কোন অংশ শুনেছ জমা হবে; লক্ষ্য বা স্ট্রিকে গোনা হবে শুধু ‘লক্ষ্য ও স্ট্রিক’ অংশে চালু করলে');
sub('লাল শব্দের অডিও');
sld('audio.ctxBefore', 'লাল শব্দে আলাফাসি: আগে কত শব্দ', 2, 0, 5, 1, 'words', 'পপআপে সঠিক তিলাওয়াত শব্দটার আগে কত শব্দসহ শোনাবে');
sld('audio.ctxAfter', 'লাল শব্দে আলাফাসি: পরে কত শব্দ', 1, 0, 5, 1, 'words');
sld('audio.myCtxWords', 'আমার পড়া: আগে কত শব্দ', 2, 0, 5, 1, 'words', 'পপআপে নিজের রেকর্ডিং কত শব্দ আগে থেকে শোনাবে', { when: 'next' });
sld('audio.popupSpeed', 'পপআপে আলাফাসির গতি', 1.0, 0.5, 1.5, 0.05, 'x');
sub('অফলাইন');
seg('audio.offlineMaxMB', 'অফলাইনে রাখার সর্বোচ্চ আকার (প্রতি সূরা)', 40, [[40, '৪০'], [80, '৮০'], [150, '১৫০'], [250, '২৫০ MB']], 'এর চেয়ে বড় সূরা শুধু ইন্টারনেটে বাজবে', { plat: 'M' });

// ---- 5 goals -------------------------------------------------------------------------------------------------
grp('goals');
add('goals.dayStart', 'দিন শুরু ধরা হবে', 'sel', 0, { help: 'রাত জেগে পড়লে আগের দিনেই গোনা হবে', options: opts([[0, 'রাত ১২টা'], [1, 'রাত ১টা'], [2, 'রাত ২টা'], [3, 'রাত ৩টা'], [4, 'রাত ৪টা'], [5, 'রাত ৫টা'], [6, 'ভোর ৬টা']]) });
seg('goals.weekStart', 'সপ্তাহ শুরু', 6, [[6, 'শনিবার'], [0, 'রবিবার'], [1, 'সোমবার']]);
chips('goals.streakMin', 'স্ট্রিকে দিন গোনার জন্য অন্তত', 'any', [['any', 'যেকোনো একটা সেশন'], ['m5', '৫ মিনিট'], ['m10', '১০ মিনিট'], ['m20', '২০ মিনিট'], ['goals', 'আজকের সব লক্ষ্য পূরণ']], null);
tog('goals.countLook', 'দেখে পড়াও মুখস্থ ও রিভিশন লক্ষ্যে গোনো', false);
tog('goals.countListen', 'শোনাও তিলাওয়াত-লক্ষ্য আর স্ট্রিকে গোনো', false);
tog('goals.countTests', 'টেস্টও লক্ষ্যে গোনো', true);
tog('goals.countManual', 'অ্যাপের বাইরের পড়াও গোনো', true);
tog('goals.showToday', 'তিলাওয়াত পাতায় আজকের লক্ষ্য দেখাও', true, 'কোনো লক্ষ্য না থাকলে কিছুই দেখাবে না');

// ---- 6 history -----------------------------------------------------------------------------------------------
grp('history'); sub('দুর্বল দাগ');
sld('history.clearStreak', 'দাগ মুছতে পরপর কত সেশন ঠিক', 3, 1, 10, 1, 'n', 'না দেখে এতগুলো আলাদা সেশনে পরপর ঠিক পড়লে লাল দাগ চলে যাবে', { when: 'next' });
tog('history.lookClears', 'দেখে পড়াও দাগ মোছায় গোনো', false, undefined, { when: 'next' });
sub('অবস্থার মাপকাঠি');
sld('history.good', '‘ভালো মুখস্থ’ কত % থেকে', 95, 80, 100, 1, 'pct');
sld('history.fair', '‘মোটামুটি’ কত % থেকে', 85, 50, 99, 1, 'pct', '‘ভালো মুখস্থ’-এর চেয়ে কম হতে হবে');
sld('history.gradeWindow', 'অবস্থা মাপতে শেষ কয়টা মুখস্থ-সেশন', 3, 1, 10, 1, 'n');
sub('তালিকা');
seg('history.recent', 'সাম্প্রতিক সেশন কয়টা দেখাবে', 30, [[10, '১০'], [30, '৩০'], [100, '১০০'], [0, 'সব']]);
seg('history.weekDays', '‘এই সপ্তাহে’ কার্ডে কত দিন', 7, [7, 14, 30], '৭ ছাড়া অন্য মান হলে কার্ডের নাম হবে ‘শেষ {n} দিনে’');
sld('history.minWords', 'সবচেয়ে ছোট কত শব্দের সেশন জমা হবে', 3, 1, 20, 1, 'words', undefined, { when: 'next' });
sld('history.maxEvents', 'প্রতিটা দুর্বল শব্দের কয়টা ভুল মনে রাখবে', 5, 1, 20, 1, 'n', undefined, { when: 'next' });
sld('history.hotZones', '‘সবচেয়ে দুর্বল জায়গা’ কয়টা দেখাবে', 3, 1, 8, 1, 'n');
tog('history.heatmap', 'তাপচিত্র দেখাও', true, 'কোন দিন কত মিনিট পড়েছ — শেষ ১২ সপ্তাহ');
tog('history.popupTimes', 'দাগের পপআপে মোট কতবার পড়েছ দেখাও', true);
sub('রেকর্ডিং');
tog('history.saveRecordings', 'সেশনের রেকর্ডিং রাখো', true, 'বন্ধ করলে নতুন রেকর্ডিং জমা হবে না, তাই পরে দাগের জায়গায় নিজের পড়া শোনা যাবে না; পুরোনোগুলো থাকবে', { when: 'next' });

// ---- 7 view --------------------------------------------------------------------------------------------------
grp('view'); sub('রং');
seg('view.theme', 'পাতার রং', 'auto', [['auto', 'স্বয়ংক্রিয়'], ['paper', 'কাগজ'], ['night', 'রাতের মুসহাফ'], ['sepia', 'পুরোনো কাগজ']]);
seg('view.wordSet', 'শব্দের রঙের সেট', 'default', [['default', 'স্বাভাবিক'], ['cb', 'রং চিনতে সুবিধা'], ['brown', 'বাদামি উঁকি'], ['custom', 'নিজের মতো']]);
seg('view.wordStyle', 'রং কীভাবে বসবে', 'text', [['text', 'লেখার রং'], ['highlight', 'হাইলাইট']], 'হাইলাইট = লেখা কালো থাকে, পেছনে রঙিন ঘর');
add('view.customColors', 'নিজের রং', 'col', {}, { help: 'প্রতিটা অবস্থার রং বেছে নাও; প্রতিটা পাতার রঙের জন্য আলাদা মনে রাখে' });
sub('লেখা');
sld('view.arabicScale', 'আরবি লেখার আকার', 100, 65, 150, 5, 'pct');
sld('view.lineGap', 'লাইনের মাঝে ফাঁক', 100, 80, 140, 5, 'pct');
sld('view.wordGap', 'শব্দের মাঝে ফাঁক', 8, 0, 40, 2, 'pct', undefined, { scale: 12.5 });
seg('view.uiScale', 'বাংলা লেখার আকার', 100, [[90, 'ছোট'], [100, 'স্বাভাবিক'], [115, 'বড়'], [130, 'আরও বড়']]);
seg('view.uiFont', 'বাংলা ফন্ট', 'app', [['app', 'হিন্দ শিলিগুড়ি'], ['system', 'যন্ত্রের নিজের ফন্ট']]);
sub('নড়াচড়া');
seg('view.motion', 'নড়াচড়া (অ্যানিমেশন)', 'auto', [['auto', 'স্বয়ংক্রিয়'], ['full', 'পুরো'], ['gentle', 'হালকা'], ['off', 'বন্ধ']], 'রেকর্ডিং চলার সময় সবসময় বন্ধ থাকে');
seg('view.scroll', 'পড়ার লাইন কোথায় থাকবে', 'second', [['second', 'ওপর থেকে দ্বিতীয় লাইনে'], ['middle', 'মাঝখানে'], ['off', 'নিজে স্ক্রল করব']]);
sub('ওপরের তথ্য');
tog('view.timer', 'সময় দেখাও', true);
tog('view.legend', 'রঙের মানে দেখাও', false, 'লেখার ওপরে ছোট করে কোন রঙের কী মানে');
tog('view.headStats', 'সঠিক, ভুল আর ইঙ্গিতের গোনা দেখাও', true);
tog('view.bnDigits', 'সংখ্যা বাংলায় লেখো', true, 'বন্ধ করলে 0–9');

// ---- 8 device ------------------------------------------------------------------------------------------------
grp('device');
add('device.micId', 'মাইক্রোফোন', 'sel', 'default', { when: 'next', plat: 'M', options: [{ v: 'default', label: 'যন্ত্রের নিজের মাইক' }] });
tog('device.echoCancel', 'প্রতিধ্বনি কমাও', true, 'আলাফাসির আওয়াজ মাইকে ঢোকা কমায়; বন্ধ করলে চুপ থাকার সাহায্য গোলমাল করতে পারে', { when: 'next', plat: 'M' });
tog('device.noiseSuppress', 'আশপাশের শব্দ কমাও', false, 'কোলাহলে কাজে লাগে, তবে নিচু গলার শব্দও কেটে যেতে পারে', { when: 'next', plat: 'M' });
seg('device.autoGain', 'মাইকের জোর নিজে ঠিক করো', 'browser', [['browser', 'ব্রাউজারের মতো'], ['on', 'চালু'], ['off', 'বন্ধ']], undefined, { when: 'next', plat: 'M' });
seg('device.sensitivity', 'মাইকের সংবেদনশীলতা', 'normal', [['low', 'কম'], ['normal', 'স্বাভাবিক'], ['high', 'বেশি']], 'আস্তে পড়লে ‘বেশি’, কোলাহলে ‘কম’', { when: 'next' });
seg('device.threads', 'প্রসেসর থ্রেড', 'auto', [['auto', 'স্বয়ংক্রিয়'], [1, '১'], [2, '২'], [4, '৪']], 'বেশি = দ্রুত, তবে ফোন গরম হতে পারে', { when: 'reload', plat: 'M' });
tog('device.slowPhone', 'ধীর ফোনে মানিয়ে নাও', true, 'ফোন ধীর হলে প্রতিবার কম অডিও শোনে, যাতে পিছিয়ে না পড়ে', { when: 'next', plat: 'M' });
seg('device.liveModel', 'লাইভ মডেল', 'tiny', [['tiny', 'tiny'], ['base', 'base']], 'বড় মডেল বেশি ঠিক শোনে, কিন্তু ধীর', { when: 'next', plat: 'L' });
seg('device.checkModel', 'যাচাই মডেল', 'base', [['base', 'base'], ['tiny', 'tiny']], 'সূরা চেনা ও লাল করার আগে আবার শোনা', { when: 'next', plat: 'L' });
tog('device.keepAwake', 'রেকর্ডিং ও শোনার সময় স্ক্রিন জ্বালিয়ে রাখো', false);
tog('device.shortcuts', 'কীবোর্ড শর্টকাট', false, 'Space = বিরতি, H = ইঙ্গিত, R = আয়াতের বাকিটা, E = চোখ, M = ভুলের তালিকা, N = পরের প্রশ্ন, P = শোনা চালাও/থামাও');
seg('device.maxRecMin', 'সর্বোচ্চ রেকর্ডিং সময়', 0, [[30, '৩০'], [60, '৬০'], [90, '৯০'], [120, '১২০ মিনিট'], [0, 'সীমা নেই']], 'এর পরে রেকর্ডিং নিজে থামবে', { when: 'next' });

// ---- 9 adv ---------------------------------------------------------------------------------------------------
grp('adv');
const adv = (id, label, def, min, max, step, help) => sld(id, label, def, min, max, step, undefined, help, { when: 'next', advanced: true });
adv('adv.windowS', 'প্রতিবার কত সেকেন্ডের অডিও শোনা হয়', 6, 3, 12, 0.5);
adv('adv.updateEveryS', 'কত ঘনঘন নতুন অডিও শোনা হয়', 0.25, 0.15, 1.0, 0.05, 'কম মান = ফোনে বেশি কাজ');
adv('adv.lookahead', 'সামনে কত শব্দ পর্যন্ত মেলানো হয়', 12, 4, 30, 1);
adv('adv.shortSkip', 'দুটো শব্দ মিললে কয়টা শব্দ টপকানো চলে', 3, 1, 6, 1);
adv('adv.longSkipRun', 'বেশি টপকাতে কয়টা শব্দ পরপর মিলতে হবে', 3, 2, 6, 1);
adv('adv.finalSkip', 'শেষ যাচাইয়ে সর্বোচ্চ টপকানো', 8, 3, 15, 1);
adv('adv.detectMinWords', 'সূরা চিনতে অন্তত কত শব্দ', 4, 2, 10, 1);
adv('adv.detectMargin', 'পরের সম্ভাব্য সূরার চেয়ে কতগুণ এগিয়ে থাকতে হবে', 1.4, 1.1, 2.5, 0.1);
adv('adv.detectSureWords', 'এত শব্দ শোনার পর কাছাকাছি হলেও বেছে নেবে', 20, 8, 40, 1);
adv('adv.lostS', 'কত সেকেন্ড না এগোলে জায়গা আবার খুঁজবে', 8, 4, 20, 1);
adv('adv.lostReds', 'শেষ কয়টার মধ্যে কতটা লাল হলে আবার খুঁজবে: লাল', 5, 2, 8, 1);
adv('adv.lostOf', '…শেষ কয়টা শব্দের মধ্যে', 8, 4, 15, 1);
adv('adv.rewindRun', 'পেছনে ফিরে পড়া চিনতে কয়টা শব্দ পরপর', 3, 2, 6, 1);
adv('adv.backWords', 'সর্বোচ্চ কত শব্দ পেছনে ফেরা চেনা হবে', 80, 20, 200, 10);
adv('adv.verifyWindowS', 'বাদ পড়া শব্দ আবার শুনতে কত সেকেন্ড', 7, 3, 15, 1);
adv('adv.verifyMaxS', '…সর্বোচ্চ কত সেকেন্ড', 20, 10, 40, 1);
adv('adv.autoExtendAt', 'সামনে কয়টা শব্দ বাকি থাকলে আরও আয়াত যোগ হবে', 15, 5, 30, 1);
adv('adv.sameAudio', '‘ঠিক পড়েছি’ মনে রাখার অডিও-মিল', 0.6, 0.40, 0.80, 0.02, 'কম = কড়া (একদম একইভাবে পড়তে হবে)');
adv('adv.sameHeard', '‘ঠিক পড়েছি’ মনে রাখার শোনা-মিল', 0.75, 0.60, 0.95, 0.05, 'বেশি = কড়া');
adv('adv.maxClipS', 'লাল শব্দের নিজের ক্লিপ সর্বোচ্চ কত সেকেন্ড', 6, 3, 12, 1);
adv('adv.stripCells', 'অগ্রগতির পট্টিতে সর্বোচ্চ ঘর', 40, 20, 80, 5);
adv('adv.cellMid', 'আয়াতের ঘর মাঝারি লাল হবে দুর্বলতা-যোগফল কত থেকে', 3, 1, 10, 1);
adv('adv.cellDark', '…গাঢ় লাল হবে কত থেকে', 6, 2, 20, 1);

// ---- presets (§5) --------------------------------------------------------------------------------------------
const PRESETS = {
  recite: { id: 'strict', label: 'ভুল ধরার কড়াকড়ি', items: [
    ['easy', 'সহজ', 'নতুন মুখস্থে: ছোটখাটো উচ্চারণে ছাড়, বাড়তি শব্দ ধরা বন্ধ', { 'detect.similarRatio': 0.6, 'detect.added': false, 'detect.confirmedWords': 25, 'detect.noAdvance': false, 'detect.changed': true, 'detect.skipped': true, 'detect.stray': true, 'adv.sameAudio': 0.68 }],
    ['normal', 'স্বাভাবিক', 'রোজকার রিভিশন', { 'detect.similarRatio': 0.7, 'detect.added': true, 'detect.confirmedWords': 15, 'detect.noAdvance': false, 'detect.changed': true, 'detect.skipped': true, 'detect.stray': true, 'adv.sameAudio': 0.6 }],
    ['strict', 'কড়া', 'শিক্ষককে শোনানোর আগে: কাছাকাছি উচ্চারণও ভুল, ভুল ঠিক না করে এগোবে না', { 'detect.similarRatio': 0.8, 'detect.added': true, 'detect.confirmedWords': 10, 'detect.noAdvance': true, 'detect.changed': true, 'detect.skipped': true, 'detect.stray': true, 'adv.sameAudio': 0.52 }],
  ] },
  test: { id: 'kind', label: 'টেস্টের ধরন', items: [
    ['quick', 'দ্রুত অনুশীলন', '', { 'test.endBy': 'count', 'test.questions': 5, 'test.lengthUnit': 'words', 'test.lengthWords': 8, 'test.hintWords': 3, 'test.start': 'ayah', 'test.showRef': true, 'test.countdown': 0, 'test.skipCounts': false }],
    ['normal', 'স্বাভাবিক', '', { 'test.endBy': 'count', 'test.questions': 10, 'test.lengthUnit': 'words', 'test.lengthWords': 15, 'test.hintWords': 3, 'test.start': 'ayah', 'test.showRef': true, 'test.countdown': 3, 'test.skipCounts': true }],
    ['hard', 'কঠিন', '', { 'test.endBy': 'count', 'test.questions': 20, 'test.lengthUnit': 'words', 'test.lengthWords': 30, 'test.hintWords': 2, 'test.start': 'random', 'test.showRef': false, 'test.countdown': 3, 'test.skipCounts': true }],
  ] },
  listen: { id: 'kind', label: 'শোনার ধরন', items: [
    ['only', 'শুধু শোনা', '', { 'listen.speed': 1, 'listen.repeatAyah': 1, 'listen.gapRepeatS': 0, 'listen.gapAyahS': 0, 'listen.gapAuto': false, 'listen.text': 'show', 'listen.highlight': 'word' }],
    ['memo', 'মুখস্থের জন্য', '', { 'listen.speed': 1, 'listen.repeatAyah': 3, 'listen.gapRepeatS': 2, 'listen.gapAyahS': 2, 'listen.gapAuto': false, 'listen.text': 'show', 'listen.highlight': 'word' }],
    ['say', 'শুনে বলো', '', { 'listen.speed': 1, 'listen.repeatAyah': 1, 'listen.gapRepeatS': 0, 'listen.gapAyahS': 0, 'listen.gapAuto': true, 'listen.text': 'reveal', 'listen.highlight': 'word' }],
    ['slow', 'ধীরে শেখা', '', { 'listen.speed': 0.75, 'listen.repeatAyah': 5, 'listen.gapRepeatS': 3, 'listen.gapAyahS': 2, 'listen.gapAuto': false, 'listen.text': 'show', 'listen.highlight': 'word' }],
  ] },
};
const presets = {};
for (const [g, p] of Object.entries(PRESETS)) presets[g] = { label: p.label, items: p.items.map(([id, label, help, values]) => ({ id, label, help, values })) };

export function buildSchema() {
  return { version: 2, groups: GROUPS.map(([id, name, help, icon]) => ({ id, name, help, icon })), presets, settings: rows };
}

// ---- strings -------------------------------------------------------------------------------------------------
import { STRINGS } from './strings-src.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(out('settings-schema.json'), `${JSON.stringify(buildSchema(), null, 1)}\n`);
  writeFileSync(out('ui-strings.json'), `${JSON.stringify(STRINGS, null, 1)}\n`);
  console.log(`settings ${rows.length}, strings ${Object.keys(STRINGS).length}`);
}
