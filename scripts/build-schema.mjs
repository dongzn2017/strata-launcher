import fs from 'node:fs';
import {engineOptionSpecs} from './strata-panel/engine-options.mjs';

const schema={$schema:'https://json-schema.org/draft/2020-12/schema',title:'Curated Strata 0.1.59 engine options',
  type:'object',additionalProperties:false,properties:Object.fromEntries(engineOptionSpecs.map(s=>[s.key,{
    type:'string',enum:s.values,default:'default',description:`${s.env || s.flag}: ${s.label}. ${s.hint} Risk: ${s.risk}`,
  }]))};
const output=JSON.stringify(schema,null,2)+'\n';
const file=new URL('../conf/engine-options.schema.json',import.meta.url);
if(process.argv[2]==='--check') {
  if(fs.readFileSync(file,'utf8')!==output) throw new Error('Generated schema is stale; run npm run schema');
} else fs.writeFileSync(file,output);
