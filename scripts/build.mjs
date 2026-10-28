import {copyFile, cp, mkdir, readFile, writeFile} from 'node:fs/promises';

await mkdir('dist', {recursive: true});
await copyFile('index.html', 'dist/index.html');
await cp('src', 'dist/src', {recursive: true});
for (const name of ['delaunator', 'robust-predicates']) await cp(`node_modules/${name}`, `dist/deps/${name}`, {recursive: true});
const delaunator = 'dist/deps/delaunator/index.js';
await writeFile(delaunator, (await readFile(delaunator, 'utf8')).replace("from 'robust-predicates'", "from '../robust-predicates/index.js'"));
console.log('Готово: dist/ (статические файлы, без внешних зависимостей).');
