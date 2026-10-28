import fs from 'node:fs'
let s = fs.readFileSync('scripts/config.js', 'utf8')
console.log('CRLF present:', s.includes('\r\n'))

s = s.replace(/\r\n?/g, '\n').replace(/\/\*\* @type \{const\} \*\//g, '')

// все маркеры-разделители, которые видит скрипт
const markers = [...s.matchAll(/\/\* ={4,}/g)]
console.log('markers found:', markers.length, markers[0]?.[0])

// первые строки после каждого маркера — это и есть «title»
const titles = [...s.matchAll(/\/\* =+[ \t]*\n([^\n]+)/g)].map(m => m[1].trim())
console.log('titles:')
titles.forEach((t, i) => console.log('  ', i, JSON.stringify(t)))