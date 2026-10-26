import { auditEditorial } from './audit-editorial-art.mjs';
auditEditorial('backdrop').catch(error => { console.error(error); process.exitCode=1; });
