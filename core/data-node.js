// Node-only helpers: read the data files from disk (the page fetches them instead).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as quran from './quran.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const readData = (name) => JSON.parse(fs.readFileSync(`${ROOT}data/${name}`, 'utf8'));
export function loadQuran() { quran.setData(readData('quran.json')); return quran; }
