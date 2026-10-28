import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL(process.argv.includes('--dist') ? '../dist/' : '../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
};
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        const dependency = relative.match(/^deps\/(delaunator|robust-predicates)\/(index\.js|esm\/[a-z0-9-]+\.js)$/);
        const full = dependency && !process.argv.includes('--dist') ? path.resolve(root, 'node_modules', dependency[1], dependency[2]) : path.resolve(root, relative);
        if (!full.startsWith(root) || relative.split(/[\\/]/).some(p => p.startsWith('.')) || !(['index.html', 'src'].includes(relative.split('/')[0]) || dependency)) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const info = await stat(full);
        if (!info.isFile()) throw new Error('Not a file');
        const raw = await readFile(full);
        const data = dependency?.[1] === 'delaunator' && dependency[2] === 'index.js'
            ? raw.toString().replace("from 'robust-predicates'", "from '../robust-predicates/index.js'") : raw;
        res.writeHead(200, {
            'Content-Type': types[path.extname(full)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});
server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Порт ${port} уже занят. Остановите предыдущий сервер или задайте другой PORT.` : `Не удалось запустить сервер: ${error.message}`);
    process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Градописарь: http://127.0.0.1:${port}`));
