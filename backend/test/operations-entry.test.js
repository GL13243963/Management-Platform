const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
test('operations entry keeps core management and validates business deep links',async()=>{
 const {isOperationsEntry,operationsEntry}=await import(pathToFileURL(path.resolve(__dirname,'../../frontend/src/router/operations-entry.js')).href);
 for(const tab of ['accounts','system'])assert.equal(isOperationsEntry({path:'/data',query:{tab}}),false);
 assert.equal(isOperationsEntry({path:'/weekly-report',query:{}}),true);assert.equal(isOperationsEntry({path:'/platform-management',query:{}}),false);
 assert.equal(operationsEntry({mode:'legacy'},{fullPath:'/weekly-report'}),null);
 assert.equal(operationsEntry({mode:'independent',version:'v1.0.0',entry:'/apps/operations/versions/v1.0.0/index.html'},{fullPath:'/weekly-report?week=2026-11-02'}),'/apps/operations/versions/v1.0.0/index.html#/weekly-report?week=2026-11-02');
 assert.throws(()=>operationsEntry({mode:'independent',version:'v1.0.0',entry:'https://example.com'},{fullPath:'/data'}));
});
