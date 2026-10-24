import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = new URL('../public/', import.meta.url);
await mkdir(new URL('images/', target), { recursive: true });
await mkdir(new URL('prototype/', target), { recursive: true });
await cp(fileURLToPath(new URL('../assets/demo/products/', target)), fileURLToPath(new URL('images/', target)), { recursive: true });
await cp(fileURLToPath(new URL('../demo/index.html', target)), fileURLToPath(new URL('prototype/index.html', target)));
console.log('Prepared local product images and the existing prototype.');
