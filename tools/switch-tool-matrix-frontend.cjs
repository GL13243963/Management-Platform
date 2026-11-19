const path=require('node:path'),service=require('../backend/src/services/tool-matrix-runtime');
function main(argv){const args={};for(let i=0;i<argv.length;i+=2){if(!argv[i+1]||Object.hasOwn(args,argv[i]))throw Error('Invalid arguments');args[argv[i]]=argv[i+1];}
const required=["--config", "--asset-root", "--target"];if(Object.keys(args).length!==required.length||required.some(k=>!args[k]))throw Error('Required: '+required.join(' '));
for(const key of required.filter(k=>['--dist','--asset-root','--config'].includes(k)))if(!path.isAbsolute(args[key]))throw Error('Use explicit absolute paths');
console.log(JSON.stringify(service.switchVersion(args['--config'],args['--asset-root'],args['--target']),null,2));}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
