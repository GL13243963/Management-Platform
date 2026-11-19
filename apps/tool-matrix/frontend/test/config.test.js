import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../vite.config.js';
test('dev proxy rejects absent or business backend ports',()=>{
 const before=process.env.TOOL_MATRIX_TEST_BACKEND_PORT;
 try {for(const port of ['', '3001','3002','https://example.com','70000']){process.env.TOOL_MATRIX_TEST_BACKEND_PORT=port;assert.throws(()=>config({command:'serve'}),/isolated backend/);}}
 finally {if(before===undefined)delete process.env.TOOL_MATRIX_TEST_BACKEND_PORT;else process.env.TOOL_MATRIX_TEST_BACKEND_PORT=before;}
});
test('build is self contained and isolated proxy remains loopback',()=>{
 const before=process.env.TOOL_MATRIX_TEST_BACKEND_PORT;
 try {delete process.env.TOOL_MATRIX_TEST_BACKEND_PORT;assert.equal(config({command:'build'}).base,'./');process.env.TOOL_MATRIX_TEST_BACKEND_PORT='61789';assert.equal(config({command:'serve'}).server.proxy['/api'].target,'http://127.0.0.1:61789');}
 finally {if(before===undefined)delete process.env.TOOL_MATRIX_TEST_BACKEND_PORT;else process.env.TOOL_MATRIX_TEST_BACKEND_PORT=before;}
});
