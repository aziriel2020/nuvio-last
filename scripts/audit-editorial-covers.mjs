import { auditEditorial } from './audit-editorial-art.mjs';
auditEditorial('cover').catch(error => { console.error(error); process.exitCode=1; });
