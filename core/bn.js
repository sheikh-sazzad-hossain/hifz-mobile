// Bengali numerals and dates (history.py's bn, _when, _duration) and Python-style rounding.
import { t, lang, digitSet, dateText } from './i18n.js';
const MONTHS = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];

let digitsOn = true; // view.bnDigits (Bengali only): off gives plain 0-9
export const setDigits = (on) => { digitsOn = !!on; };
// the name stays `bn` (used everywhere): it writes the digits of the CURRENT language: Bengali (or 0-9 when view.bnDigits is off), Arabic-Indic for ar, Persian for fa, Latin for the rest
export const bn = (x) => {
  const set = digitSet(lang());
  if (!set || (lang() === 'bn' && !digitsOn)) return String(x);
  return String(x).replace(/[0-9]/g, (d) => set[Number(d)]);
};

const pad = (n) => String(n).padStart(2, '0');

// Local time as "YYYY-MM-DDTHH:MM:SS" (Python's datetime.isoformat(timespec="seconds") of a naive local datetime).
export function isoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const parseLocal = (iso) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso); // no zone: local time

export function when(iso) {
  const d = parseLocal(iso);
  if (lang() !== 'bn') return bn(dateText(d, { time: true }));
  return bn(`${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

export function duration(seconds) {
  const m = Math.floor(Math.floor(seconds) / 60);
  const s = Math.floor(seconds) % 60;
  return m ? bn(t('fmt.durMS', { m, s })) : bn(t('fmt.durS', { s }));
}

// Python's round(x, digits): ties (only exactly representable ones) go to the even digit.
export function pyRound(x, digits = 0) {
  const exact = Math.abs(x).toFixed(Math.min(100, digits + 40)); // exact decimal expansion of the double
  const cut = exact.length - 40;
  if (/^50*$/.test(exact.slice(cut))) { // exactly half: round to even
    const down = exact.slice(0, cut).replace('.', '');
    const lastDigit = Number(down.slice(-1));
    const base = BigInt(down) + (lastDigit % 2 === 0 ? 0n : 1n);
    const str = base.toString().padStart(digits + 1, '0');
    const out = digits ? `${str.slice(0, -digits)}.${str.slice(-digits)}` : str;
    return x < 0 ? -Number(out) : Number(out);
  }
  return Number(x.toFixed(digits));
}

export function dateOnly(iso) { // "১৪ নভে"
  const d = parseLocal(iso);
  if (lang() !== 'bn') return bn(dateText(d));
  return bn(`${d.getDate()} ${MONTHS[d.getMonth()]}`);
}
